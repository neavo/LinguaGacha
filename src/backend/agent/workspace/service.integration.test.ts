import { create_empty_agent_workspace_intent_batch } from "../../project/agent-workspace-write";
import { read_pdf_document } from "../../file/formats/pdf/pdf-document";
import type { WorkspaceHostPort, WorkspaceHostResult } from "./runtime/host-contract";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { BackendResources } from "../../bootstrap/backend-resources";
import { BackendServices } from "../../bootstrap/backend-services";
import { AgentWorkspaceService } from "./service";
import {
  create_workspace_runtime_fixture,
  workspace_execution,
} from "../../../test/agent-workspace-fixture";
import { create_pdf_fixture } from "../../file/formats/pdf/test-support";
import { pdf_page_fingerprint } from "../../file/formats/pdf/pdf-source";
import { ProjectDataReader } from "../../project/project-data-reader";

it("PDF 零条目工程按页保存、隔离旧指纹，语言变化后重建工作区继续并导出", async () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-pdf-workspace-"));
  fs.writeFileSync(path.join(directory.path, "version.txt"), "0.0.0");
  const source = path.join(directory.path, "book.pdf");
  fs.writeFileSync(
    source,
    create_pdf_fixture(["Same extracted text", "Same extracted text", null]),
  );
  const resources = await BackendResources.start({
    appRoot: directory.path,
    builtinRoot: path.resolve("builtin"),
    logTargets: { console: false, window: false },
    systemProxyResolver: { resolveProxy: async () => "DIRECT" },
  });
  const services = new BackendServices({
    paths: resources.paths,
    metadata: resources.metadata,
    appSettingService: resources.settings,
    database: resources.database,
    logManager: resources.logManager,
    publishEvent: () => {},
    openOutputFolder: async () => {},
    pdfHost: async () => create_pdf_fixture(["Translated page"]),
    workerExecution: { kind: "in_process" },
  });
  try {
    resources.settings.set_transient_overrides({ source_language: "EN", target_language: "ZH" });
    await services.project.lifecycle.create_project_commit({
      path: path.join(directory.path, "project.lg"),
      source_paths: [source],
      project_settings: {
        source_language: "EN",
        target_language: "ZH",
        skip_duplicate_source_text_enable: true,
        mtool_optimizer_enable: false,
      },
    });
    let operation: ((host: WorkspaceHostPort) => Promise<WorkspaceHostResult>) | undefined;
    let output: WorkspaceHostResult | undefined;
    const workspace = new AgentWorkspaceService({
      images: {
        prepare: async (bytes) => ({
          data: Buffer.from(bytes).toString("base64"),
          mimeType: "image/webp",
          width: 1,
          height: 1,
          originalWidth: 1,
          originalHeight: 1,
        }),
      },
      paths: resources.paths,
      settings: resources.settings,
      sessionState: services.state.session,
      cache: services.state.cache,
      proofreading: services.proofreading.query,
      database: resources.database,
      runtimeGate: { run_agent_project_write: async (operation) => operation() },
      writeStore: services.state.writes,
      logManager: resources.logManager,
      run: async (request) => {
        if (operation) output = await operation(request.host!);
        return { execution: workspace_execution(), todos: [] };
      },
      runtimeDirectory: create_workspace_runtime_fixture(directory.path),
      openDirectory: async () => {},
      pickSavePath: async () => null,
      pdfHost: async () => create_pdf_fixture(["Translated page"]),
      exportPDF: (file_path, signal) =>
        services.files.translationExport.export_pdf_file(file_path, signal),
    });
    await workspace.initialize();
    await workspace.run("", [], new AbortController().signal);
    const root = resources.paths.get_agent_workspace_root_dir();
    const project_path = services.state.session.require_loaded_project_path();
    // 每次从数据库重读，验证保存与重开后的事实而非缓存引用。
    const read_document = () => resources.database.read_pdf_document(project_path, "book.pdf")!;
    expect(resources.database.get_item_count(project_path)).toBe(0);
    expect(services.state.cache.files.readFileEntries()).toEqual([
      { rel_path: "book.pdf", file_type: "PDF", sort_index: 0 },
    ]);
    const source_path = path.join(root, "sources/book.pdf/original.pdf");
    const source_mtime = fs.statSync(source_path).mtimeMs;
    const draft = {
      translation: { kind: "translate" as const, markdown: "跨页段落\n\n图中是蓝色矩形。" },
      reviewed: true,
      notes: "等待版式核对",
    };
    const original = read_document();
    const original_fp = pdf_page_fingerprint("book.pdf", original.digest, original.pages[0]!);
    const second_fp = pdf_page_fingerprint("book.pdf", original.digest, original.pages[1]!);
    const request_approval = vi.fn(async () => undefined);
    // 通过真实 JSONL 接口提交单页，保留其它页的持久状态。
    const save = async (fp: string, update: typeof draft) => {
      fs.writeFileSync(
        path.join(root, "changes/pdf/updates.jsonl"),
        JSON.stringify({ file_path: "book.pdf", page: 1, fp, ...update }),
      );
      return workspace.apply_workspace(request_approval);
    };
    const before = services.state.cache.snapshot();
    expect((await save(original_fp, draft))["status"]).toBe("applied");
    expect(request_approval).toHaveBeenCalledExactlyOnceWith({
      pdf: 1,
      items: 0,
      glossary: 0,
      textPreserve: 0,
      preReplacement: 0,
      postReplacement: 0,
      prompts: 0,
    });
    expect(services.project.summary.read()["snapshot"]).toMatchObject({
      entries: [
        {
          file_type: "PDF",
          progress: {
            unit: "page",
            total_count: 3,
            completed_count: 1,
            skipped_count: 0,
            failed_count: null,
            pending_count: 2,
            completion_percent: 33,
          },
        },
      ],
    });
    const after = services.state.cache.snapshot();
    expect(after.epoch).toBe(before.epoch);
    expect(after.sectionRevisions.items).toBe(before.sectionRevisions.items);
    expect(after.sectionRevisions.files).toBe(before.sectionRevisions.files);
    expect(after.sectionRevisions.pdf).toBeGreaterThan(before.sectionRevisions.pdf ?? 0);
    await workspace.run("", [], new AbortController().signal);
    expect(fs.statSync(source_path).mtimeMs).toBe(source_mtime);
    expect((await save(original_fp, { ...draft, notes: "stale" }))["status"]).toBe("rejected");
    expect(read_document().pages[0]!.notes).toBe("等待版式核对");
    await workspace.run("", [], new AbortController().signal);
    const baseline = read_document();
    const baseline_fp = pdf_page_fingerprint("book.pdf", baseline.digest, baseline.pages[0]!);
    // 快照后其它写入者修改同一页，工作区应保留真实漂移的页级拒绝原因。
    await services.state.writes.apply_agent_workspace_changes({
      projectPath: project_path,
      source: "agent_workspace_apply",
      batch: {
        ...create_empty_agent_workspace_intent_batch(),
        pdf: [
          { file_path: "book.pdf", page: 1, fp: baseline_fp, line: 1, ...draft, reviewed: false },
        ],
      },
    });
    fs.writeFileSync(
      path.join(root, "changes/pdf/updates.jsonl"),
      [
        { file_path: "book.pdf", page: 1, fp: baseline_fp, ...draft, notes: "stale" },
        {
          file_path: "book.pdf",
          page: 2,
          fp: second_fp,
          translation: { kind: "translate", markdown: "" },
          reviewed: true,
          notes: "正文归入第 1 页",
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    const partial = await workspace.apply_workspace(request_approval);
    expect(partial["applied"]).toEqual({ pdf: { updated: 1 } });
    expect(partial["rejected"]).toMatchObject([
      { file_path: "book.pdf", page: 1, reason: "fp_mismatch" },
    ]);
    expect(read_document().pages[0]!.notes).toBe("等待版式核对");
    expect(read_document().pages[2]).toEqual(original.pages[2]);
    await workspace.initialize();
    resources.settings.set_transient_overrides({ source_language: "ALL", target_language: "DE" });
    resources.database.upsert_meta_entries(project_path, {
      source_language: "ALL",
      target_language: "DE",
    });
    resources.database.close_project(project_path);
    await workspace.run("", [], new AbortController().signal);
    const rows = fs
      .readFileSync(path.join(root, "pdf/entries.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ file_path: "book.pdf", page: 1, ...draft, reviewed: false });
    expect(rows[1]).toMatchObject({
      page: 2,
      translation: { kind: "translate", markdown: "" },
      notes: "正文归入第 1 页",
    });
    expect(rows[2].fp).toBe(pdf_page_fingerprint("book.pdf", original.digest, original.pages[2]!));
    draft.notes = "重新读取工程设置后继续核对";
    expect(
      (
        await save(
          pdf_page_fingerprint("book.pdf", read_document().digest, read_document().pages[0]!),
          draft,
        )
      )["status"],
    ).toBe("applied");
    operation = (host) =>
      host(
        { kind: "export_pdf", file_path: "book.pdf", fp: original_fp },
        new AbortController().signal,
      );
    await expect(workspace.run("", [], new AbortController().signal)).rejects.toThrow();
    operation = (host) =>
      host(
        {
          kind: "export_pdf",
          file_path: "book.pdf",
          fp: JSON.parse(fs.readFileSync(path.join(root, "project_meta.json"), "utf8")).files[0]
            .pdf_fp,
        },
        new AbortController().signal,
      );
    await workspace.run("", [], new AbortController().signal);
    expect(output && "output_path" in output).toBe(true);
    if (output && "output_path" in output) {
      const exported = read_pdf_document(new Uint8Array(fs.readFileSync(output.output_path)));
      expect(exported.pages).toHaveLength(2);
    }
    expect(read_document().pages[0]).toMatchObject(draft);
    const revision = () =>
      new ProjectDataReader(resources.database).build_manifest({
        loaded: true,
        projectPath: project_path,
      })["sectionRevisions"];
    await services.project.content.reset_files({
      rel_paths: ["book.pdf"],
      expected_section_revisions: revision(),
    });
    expect(
      read_document().pages.every(
        (page) => page.translation === null && !page.reviewed && page.notes === "",
      ),
    ).toBe(true);
    expect(read_document().pages).toHaveLength(3);
    await services.project.content.delete_files({
      rel_paths: ["book.pdf"],
      expected_section_revisions: revision(),
    });
    expect(resources.database.read_pdf_document(project_path, "book.pdf")).toBeNull();
    expect(resources.database.read_asset_content(project_path, "book.pdf")).toBeNull();
  } finally {
    await services.dispose();
    await resources.dispose();
  }
});
