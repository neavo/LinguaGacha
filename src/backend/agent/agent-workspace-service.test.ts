import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTING } from "../../domain/setting";
import type { JsonRecord } from "../../domain/json";
import type { CacheReadPort, CacheSnapshot } from "../cache/cache-types";
import type { ProjectDataSectionRevisions, ProjectWriteResult } from "../../shared/project-event";
import { AgentWorkspaceService, type AgentWorkspaceRunPort } from "./agent-workspace-service";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-workspace-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("AgentWorkspaceService", () => {
  it("导出固定完整上下文，并把全部 item 差异一次交给领域入口", async () => {
    const items = Array.from({ length: 3 }, (_, index) => create_item(index + 1));
    const fixture = create_fixture({ items });
    fixture.run.mockImplementationOnce(async ({ workspacePath }) => {
      const target_path = path.join(workspacePath, "target", "items.jsonl");
      const rows = read_jsonl(target_path).map((row) => ({
        ...row,
        dst: `译文-${row["item_id"]}`,
      }));
      write_jsonl(target_path, rows);
      return { result: { changed: rows.length } };
    });
    await fixture.service.initialize();

    const manifest = await fixture.service.export_workspace("items");
    const run_result = await fixture.service.run_script(
      "return { changed: 3 };",
      new AbortController().signal,
    );
    const import_result = await fixture.service.import_workspace();

    expect(manifest).toMatchObject({ target: "items", counts: { items: 3 } });
    expect(run_result).toEqual({ changed: 3 });
    expect(fixture.item_update).toHaveBeenCalledOnce();
    const request = fixture.item_update.mock.calls[0]?.[0] as JsonRecord;
    expect(request["changes"]).toHaveLength(3);
    expect((request["changes"] as JsonRecord[])[0]).toEqual({ item_id: 1, dst: "译文-1" });
    expect(import_result).toEqual({
      status: "applied",
      target: "items",
      updated: 3,
      revisions: { items: 2, proofreading: 2 },
    });
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });

  it("脚本失败时废弃整个工作区", async () => {
    const fixture = create_fixture({ items: [create_item(1)] });
    await fixture.service.initialize();
    await fixture.service.export_workspace("items");
    fixture.run.mockRejectedValueOnce(new Error("script failed"));

    await expect(
      fixture.service.run_script("throw new Error()", new AbortController().signal),
    ).rejects.toThrow("script failed");
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });

  it("工程快照过期时废弃整个工作区并要求重新导出", async () => {
    const fixture = create_fixture({ items: [create_item(1)] });
    await fixture.service.initialize();
    await fixture.service.export_workspace("items");
    fixture.snapshot.sectionRevisions.items = 2;
    await expect(
      fixture.service.run_script("return null", new AbortController().signal),
    ).rejects.toThrow("request.validation_failed");
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });

  it("新导出替换旧目录，未修改导入返回 unchanged 后销毁当前工作区", async () => {
    const fixture = create_fixture({ items: [create_item(1)] });
    await fixture.service.initialize();
    await fixture.service.export_workspace("items");
    const first_workspace = fs.readdirSync(fixture.workspace_root)[0];

    await fixture.service.export_workspace("items");
    const active_workspaces = fs.readdirSync(fixture.workspace_root);
    expect(active_workspaces).toHaveLength(1);
    expect(active_workspaces[0]).not.toBe(first_workspace);

    await expect(fixture.service.import_workspace()).resolves.toEqual({
      status: "unchanged",
      target: "items",
      updated: 0,
      revisions: { items: 1, proofreading: 1 },
    });
    expect(fixture.item_update).not.toHaveBeenCalled();
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });

  it("target 身份字段被改写时在领域写入前拒绝，并保留工作区供修复", async () => {
    const fixture = create_fixture({ items: [create_item(1)] });
    fixture.run.mockImplementationOnce(async ({ workspacePath }) => {
      const target_path = path.join(workspacePath, "target", "items.jsonl");
      const [row] = read_jsonl(target_path);
      write_jsonl(target_path, [{ ...row, src: "伪造原文", dst: "译文" }]);
      return { result: null };
    });
    await fixture.service.initialize();
    await fixture.service.export_workspace("items");
    await fixture.service.run_script("return null", new AbortController().signal);

    await expect(fixture.service.import_workspace()).rejects.toThrow("request.validation_failed");

    expect(fixture.item_update).not.toHaveBeenCalled();
    expect(fs.readdirSync(fixture.workspace_root)).toHaveLength(1);
  });

  it("glossary target 支持修改、删除和新增，并导出分析候选上下文", async () => {
    const fixture = create_fixture({
      items: [create_item(1)],
      glossary: [
        { entry_id: "term-a", src: "姫", dst: "公主", info: "身份", case_sensitive: true },
        { entry_id: "term-b", src: "城", dst: "城堡", info: "地点", case_sensitive: true },
      ],
    });
    fixture.run.mockImplementationOnce(async ({ workspacePath }) => {
      const target_path = path.join(workspacePath, "target", "glossary.jsonl");
      write_jsonl(target_path, [
        { id: "term-a", src: "姫", dst: "姬", info: "女性称谓", case_sensitive: true },
        { src: "王都", dst: "王都", info: "地名", case_sensitive: true },
      ]);
      expect(fs.existsSync(path.join(workspacePath, "context", "analysis_candidates.jsonl"))).toBe(
        true,
      );
      return { result: { changed: 3 } };
    });
    await fixture.service.initialize();
    await fixture.service.export_workspace("glossary");
    await fixture.service.run_script("return { changed: 3 }", new AbortController().signal);

    const result = await fixture.service.import_workspace();

    expect(result).toMatchObject({ status: "applied", target: "glossary" });
    const request = fixture.quality_update.mock.calls[0]?.[0] as JsonRecord;
    const entries = request["entries"] as JsonRecord[];
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      entry_id: "term-a",
      src: "姫",
      dst: "姬",
      info: "女性称谓",
      case_sensitive: true,
    });
    expect(entries[1]?.["entry_id"]).toEqual(expect.any(String));
    expect(entries[1]?.["src"]).toBe("王都");
  });
});

function create_fixture(options: { items: JsonRecord[]; glossary?: JsonRecord[] }) {
  const workspace_root = path.join(temp_dir, "workspace");
  const revisions = {
    files: 1,
    items: 1,
    quality: 1,
    prompts: 1,
    analysis: 1,
    proofreading: 1,
  };
  const snapshot: CacheSnapshot = {
    projectPath: path.join(temp_dir, "project.lg"),
    epoch: 1,
    freshness: "fresh",
    sectionRevisions: revisions,
    itemCount: options.items.length,
  };
  const quality = {
    glossary: { entries: options.glossary ?? [], enabled: true, mode: null },
    text_preserve: { entries: [], enabled: true, mode: "smart" },
    pre_replacement: { entries: [], enabled: true, mode: null },
    post_replacement: { entries: [], enabled: true, mode: null },
  };
  const cache: CacheReadPort = {
    items: { readItems: () => options.items, readItem: () => null },
    files: { readFileEntries: () => [{ rel_path: "script.txt", file_type: "TXT", sort_index: 0 }] },
    quality: { readBlock: () => quality },
    prompts: { readBlock: () => ({ translation: { enabled: true, text: "保持语气" } }) },
    analysis: { readBlock: () => ({ candidate_count: 1 }) },
    readSectionRevisions: () => revisions,
    snapshot: () => snapshot,
  };
  const item_update = vi.fn(async (_request: JsonRecord, _source: string) =>
    create_write_result({ items: 2, proofreading: 2 }),
  );
  const quality_update = vi.fn(async (_request: JsonRecord, _source: string) =>
    create_write_result({ quality: 2 }),
  );
  const run = vi.fn<AgentWorkspaceRunPort>(async () => ({ result: null }));
  const service = new AgentWorkspaceService({
    paths: { get_agent_workspace_root_dir: () => workspace_root },
    settings: { read_setting: () => ({ ...DEFAULT_SETTING }) },
    sessionState: { require_loaded_project_path: () => snapshot.projectPath },
    cache,
    proofreading: {
      query: {
        query_warnings: async () => ({
          projectPath: snapshot.projectPath,
          sectionRevisions: revisions,
          data: { total_item_count: 0, items: [] },
        }),
      },
      commands: { update_items_from_agent_workspace: item_update },
    },
    qualityRules: { update_from_agent: quality_update },
    readAnalysisCandidates: () => ({
      candidate_aggregate: {
        王都: { src: "王都", dst_votes: { 王都: 2 }, info_votes: {}, observation_count: 2 },
      },
    }),
    run,
  });
  return {
    service,
    workspace_root,
    snapshot,
    run,
    item_update,
    quality_update,
  };
}

function create_item(item_id: number): JsonRecord {
  return {
    id: item_id,
    file_path: "script.txt",
    row: item_id - 1,
    src: `原文-${item_id.toString()}`,
    dst: "",
    name_src: null,
    name_dst: null,
    status: "NONE",
    retry_count: 0,
  };
}

function read_jsonl(file_path: string): JsonRecord[] {
  return fs
    .readFileSync(file_path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRecord);
}

function write_jsonl(file_path: string, rows: JsonRecord[]): void {
  fs.writeFileSync(file_path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf-8");
}

function create_write_result(section_revisions: ProjectDataSectionRevisions): ProjectWriteResult {
  return {
    accepted: true,
    changes: [
      {
        type: "project.changed",
        eventId: "workspace-test",
        source: "agent_workspace",
        projectPath: "test.lg",
        projectRevision: Math.max(...Object.values(section_revisions), 0),
        sectionRevisions: section_revisions,
        updatedSections: Object.keys(section_revisions) as Array<keyof typeof section_revisions>,
      },
    ],
  };
}
