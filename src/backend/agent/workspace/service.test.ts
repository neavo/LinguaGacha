import { project_agent_workspace_warning } from "./service";
import { Check } from "typebox/value";
import { AGENT_WORKSPACE_WARNING_SCHEMA } from "./schema";
import type { ProofreadingWarning } from "../../../shared/proofreading/proofreading-types";
import { read_pdf_document } from "../../file/pdf/pdf-document";
import { BackendResources } from "../../bootstrap/backend-resources";
import { BackendServices } from "../../bootstrap/backend-services";
import { create_pdf_fixture } from "../../file/pdf/test-support";
import { agent_workspace_page_fingerprint } from "../../project/agent-workspace-page-write";
import type { PDFHost, PDFPageUpdate } from "../../../shared/pdf";
import {
  create_empty_quality_rule_block,
  ProjectDataReader,
} from "../../project/project-data-reader";
import { normalize_quality_rule_entries } from "../../../shared/quality/quality-rule-entry";
import { QualityRule } from "../../../domain/quality";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectItemPublicRecord } from "../../../domain/item";
import { DEFAULT_SETTING } from "../../../domain/setting";
import { read_json_record, type JsonRecord } from "../../../domain/json";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../../domain/quality";
import * as AppErrors from "../../../shared/error";
import {
  PROJECT_DATA_SECTIONS,
  type ProjectDataSectionRevisions,
} from "../../../shared/project-event";
import { NativeFs } from "../../../native/native-fs";
import type { CacheReadPort } from "../../cache/cache-types";
import type { ProjectWriteStore } from "../../project/project-write-store";
import type { AgentImageService } from "../agent-image-service";
import {
  create_empty_agent_workspace_intent_batch,
  has_agent_workspace_applied_changes,
  resolve_agent_workspace_writes,
} from "../../project/agent-workspace-write";
import {
  AGENT_DOCUMENT_MAX_BYTES,
  AgentWorkspaceService,
  type AgentWorkspaceRunPort,
} from "./service";
import {
  AGENT_WORKSPACE_CHANGE_PATHS,
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS,
  AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
  AGENT_WORKSPACE_QUALITY_ENTRY_PATHS,
} from "./paths";
import { AGENT_WORKSPACE_CONTRACT, AGENT_WORKSPACE_REFERENCES } from "../tools/contract";
import { AgentWorkspaceRunError } from "./runtime/runner";
import {
  AGENT_WORKSPACE_RUN_ROOT,
  AGENT_WORKSPACE_WORK_ROOT,
  AGENT_WORKSPACE_RUNTIME_POLICY,
} from "./runtime/policy";

import {
  workspace_execution,
  create_workspace_runtime_fixture,
} from "../../../test/agent-workspace-fixture";

const VALID_WORKSPACE_SCRIPT = "console.log(null);";

describe("AgentWorkspaceService", () => {
  let temp_dir = "";

  beforeEach(() => {
    temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-workspace-"));
  });

  afterEach(() => {
    fs.rmSync(temp_dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("脚本图片按调用顺序固定字节，文件覆盖与删除不改变已接收内容", async () => {
    const fixture = await create_fixture(temp_dir);
    fixture.run.mockImplementationOnce(async (request, signal) => {
      const file = path.join(request.workspacePath, "work", "页面 # %23.webp");
      fs.writeFileSync(file, "first");
      await request.emitImage!("work/页面 # %23.webp", signal);
      fs.writeFileSync(file, "second");
      await request.emitImage!("work/页面 # %23.webp", signal, { maxEdge: 3840 });
      fs.unlinkSync(file);
      await expect(request.emitImage!("../outside.webp", signal)).rejects.toBeDefined();
      return workspace_execution();
    });
    const result = await fixture.service.run(VALID_WORKSPACE_SCRIPT, new AbortController().signal);
    expect(result.images.map(({ image }) => Buffer.from(image.data, "base64").toString())).toEqual([
      "first",
      "second",
    ]);
    expect(result.images.map(({ image }) => image.width)).toEqual([1, 3840]);
  });

  it("图片数量超限提供恢复信息，后续程序可继续输出现有文件", async () => {
    const fixture = await create_fixture(temp_dir);
    const limit = AGENT_WORKSPACE_RUNTIME_POLICY.imageCount;
    const image_path = "work/image.webp";
    fixture.run.mockImplementationOnce(async (request, signal) => {
      fs.writeFileSync(path.join(request.workspacePath, image_path), "image");
      for (let i = 0; i < limit; i++) await request.emitImage!(image_path, signal);
      await expect(request.emitImage!(image_path, signal)).rejects.toThrow(image_path);
      return workspace_execution();
    });
    expect((await run_workspace(fixture)).images).toHaveLength(limit);
    fixture.run.mockImplementationOnce(async (request, signal) => {
      await request.emitImage!(image_path, signal);
      return workspace_execution();
    });
    expect((await run_workspace(fixture)).images).toHaveLength(1);
  });

  it("失败输出只携带图片摘要，恢复时可读取保留的文件", async () => {
    const fixture = await create_fixture(temp_dir);
    fixture.run.mockImplementationOnce(async (request, signal) => {
      fs.writeFileSync(path.join(request.workspacePath, "work/image.webp"), "image");
      await request.emitImage!("work/image.webp", signal);
      throw new AgentWorkspaceRunError("failed after image", {
        ...workspace_execution(),
        exitCode: 1,
      });
    });
    await expect(run_workspace(fixture)).rejects.toMatchObject({
      public_details: {
        images: [
          {
            path: "work/image.webp",
            mime_type: "image/webp",
            width: 1,
            height: 1,
            original_width: 1,
            original_height: 1,
          },
        ],
      },
    });
    expect(fs.readFileSync(path.join(fixture.workspace_root, "work/image.webp"), "utf8")).toBe(
      "image",
    );
  });

  it("文件入口统一描述文档、图片、目录和上传文件的原名称", async () => {
    const fixture = await create_file_fixture(temp_dir);
    expect(fixture.service.describe_file(fixture.href)).toMatchObject({
      kind: "file",
      preview: "markdown",
      name: "结果 # %23.md",
    });
    expect(fixture.service.describe_file("work/")).toMatchObject({
      kind: "directory",
      preview: null,
    });
    fs.writeFileSync(path.join(fixture.workspace_root, "work", "data.bin"), "data");
    expect(fixture.service.describe_file("work/data.bin").preview).toBeNull();
    const file = await fixture.service.uploads.upload(
      "原始 名称.png",
      new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]).stream(),
      new AbortController().signal,
    );
    const href = file.path.split("/").map(encodeURIComponent).join("/");
    expect(fixture.service.describe_file(href)).toMatchObject({
      path: href,
      name: file.name,
      preview: "image",
    });
    await fixture.service.activate_path(href);
    expect(fixture.pick_save_path).toHaveBeenCalledWith(file.name);
  });

  it("文档预览返回规范路径和完整文本，复用编码探测且无需保存对话框", async () => {
    const fixture = await create_file_fixture(temp_dir);
    fs.writeFileSync(
      fixture.file,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("# 结论\n报告", "utf16le")]),
    );
    expect(await fixture.service.read_document(fixture.href + "#结论")).toEqual({
      path: "work/%E7%BB%93%E6%9E%9C%20%23%20%2523.md",
      content: "# 结论\n报告",
    });
    expect(fixture.pick_save_path).not.toHaveBeenCalled();
    expect(fixture.run).not.toHaveBeenCalled();
    await expect(fixture.service.read_document("../outside.md")).rejects.toMatchObject({
      code: "request.validation_failed",
    });
    await expect(fixture.service.read_document("work/missing.md")).rejects.toMatchObject({
      code: "file.not_found",
    });
    await expect(fixture.service.read_document("work/data.bin")).rejects.toMatchObject({
      code: "file.invalid_structure",
    });
    fs.writeFileSync(fixture.file, Buffer.alloc(AGENT_DOCUMENT_MAX_BYTES + 1));
    await expect(fixture.service.read_document(fixture.href)).rejects.toMatchObject({
      code: "file.preview_too_large",
    });
  });

  it("预览图片保持字节，多份读取互不占锁，脚本写入期间拒绝预览", async () => {
    const fixture = await create_file_fixture(temp_dir);
    const bytes = Buffer.from([137, 80, 78, 71, 0, 255]);
    fs.writeFileSync(path.join(fixture.workspace_root, "work", "chart.png"), bytes);
    const [document, image] = await Promise.all([
      fixture.service.read_document(fixture.href),
      fixture.service.read_document_image("work/chart.png"),
    ]);
    expect(document.content).toBe("报告");
    expect(image).toEqual({ bytes, mime: "image/png" });
    fixture.run.mockImplementationOnce(async () => {
      await expect(fixture.service.read_document(fixture.href)).rejects.toMatchObject({
        code: "runtime.busy",
      });
      return workspace_execution();
    });
    await run_workspace(fixture);
  });

  it("保存编码文件链接并打开目录，保留源文件且不建立快照", async () => {
    const fixture = await create_file_fixture(temp_dir);
    await expect(
      fixture.service.activate_path("work/结果%20%23%20%2523.md#section"),
    ).resolves.toEqual({ status: "saved" });
    expect(fs.readFileSync(fixture.destination)).toEqual(fs.readFileSync(fixture.file));
    expect(fixture.pick_save_path).toHaveBeenCalledWith("结果 # %23.md");
    await expect(fixture.service.activate_path("work/")).resolves.toEqual({ status: "opened" });
    expect(fixture.open_directory).toHaveBeenCalledExactlyOnceWith(path.dirname(fixture.file));
    expect(fixture.run).not.toHaveBeenCalled();
    expect(fixture.active_path()).toBe("");
  });

  it.each([
    undefined,
    "",
    "../outside",
    "work/%2e%2e/outside",
    "/tmp/report",
    "C:/report",
    "work\\report",
    "work/%00",
    "work/%ZZ",
  ])("拒绝无效工作区链接：%s", async (href) => {
    const fixture = await create_file_fixture(temp_dir);
    await expect(fixture.service.activate_path(href)).rejects.toMatchObject({
      code: "request.validation_failed",
    });
    expect(fixture.open_directory).not.toHaveBeenCalled();
    expect(fixture.pick_save_path).not.toHaveBeenCalled();
  });

  it("跟随 work 内链接交付文件，重置使入口失效并保留外部目标", async () => {
    const fixture = await create_file_fixture(temp_dir);
    await expect(fixture.service.activate_path("work/missing.md")).rejects.toMatchObject({
      code: "file.not_found",
    });
    const outside = path.join(temp_dir, "outside");
    fs.mkdirSync(outside);
    const linked = path.join(fixture.workspace_root, "work", "output");
    fs.symlinkSync(outside, linked, process.platform === "win32" ? "junction" : "dir");
    const report = path.join(outside, "report.md");
    fs.writeFileSync(report, "外部译文");
    await expect(fixture.service.activate_path("work/output/")).resolves.toEqual({
      status: "opened",
    });
    expect(fixture.open_directory).toHaveBeenCalledWith(linked);
    await expect(fixture.service.activate_path("work/output/report.md")).resolves.toEqual({
      status: "saved",
    });
    expect(fs.readFileSync(fixture.destination, "utf8")).toBe("外部译文");
    fixture.pick_save_path.mockImplementationOnce(async () => {
      await fixture.service.close();
      await fixture.service.delete_session("test0001");
      await fixture.service.activate_session("test0001", [], async () => {});
      return fixture.destination;
    });
    await expect(fixture.service.activate_path("work/output/report.md")).rejects.toMatchObject({
      code: "file.not_found",
    });
    expect(fs.existsSync(linked)).toBe(false);
    expect(fs.readFileSync(report, "utf8")).toBe("外部译文");
  });

  it("取消保存不产生文件，宿主失败保留原因", async () => {
    const fixture = await create_file_fixture(temp_dir);
    fixture.pick_save_path.mockResolvedValueOnce(null);
    await expect(fixture.service.activate_path(fixture.href)).resolves.toEqual({
      status: "cancelled",
    });
    expect(fs.existsSync(fixture.destination)).toBe(false);
    const cause = new Error("dialog failed");
    fixture.pick_save_path.mockRejectedValueOnce(cause);
    await expect(fixture.service.activate_path(fixture.href)).rejects.toMatchObject({
      code: "file.io_failed",
      cause,
    });
  });

  it("保存确认时的内容，普通快照刷新保留 work 链接", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    const file = path.join(fixture.workspace_root, "work", "report.md");
    fs.writeFileSync(file, "初稿");
    fixture.pick_save_path.mockImplementationOnce(async () => {
      fixture.snapshot.sectionRevisions.items = 2;
      await run_workspace(fixture);
      fs.writeFileSync(file, "定稿");
      return path.join(temp_dir, "saved.md");
    });
    await expect(fixture.service.activate_path("work/report.md")).resolves.toEqual({
      status: "saved",
    });
    expect(fs.readFileSync(path.join(temp_dir, "saved.md"), "utf8")).toBe("定稿");
  });

  it.each(["reset", "project"] as const)(
    "等待保存时 %s 使旧链接失效，同名新文件不能被保存",
    async (action) => {
      const fixture = await create_file_fixture(temp_dir);
      fixture.pick_save_path.mockImplementationOnce(async () => {
        await fixture.service.close();
        if (action === "reset") await fixture.service.delete_session("test0001");
        await fixture.service.activate_session("test0001", [], async () => {});
        fs.mkdirSync(path.dirname(fixture.file), { recursive: true });
        fs.writeFileSync(fixture.file, "新会话文件");
        return fixture.destination;
      });
      await expect(fixture.service.activate_path(fixture.href)).rejects.toMatchObject({
        code: "file.not_found",
      });
      expect(fs.existsSync(fixture.destination)).toBe(false);
    },
  );

  it("脚本运行期间确认保存返回忙碌，目录仍可打开", async () => {
    const fixture = await create_fixture(temp_dir);
    fixture.run.mockImplementationOnce(async () => {
      fs.writeFileSync(path.join(fixture.workspace_root, "work", "ready.md"), "ready");
      fixture.pick_save_path.mockResolvedValueOnce(path.join(temp_dir, "saved.md"));
      await expect(fixture.service.activate_path("work/ready.md")).rejects.toMatchObject({
        code: "runtime.busy",
      });
      await expect(fixture.service.activate_path("work/")).resolves.toEqual({ status: "opened" });
      return workspace_execution();
    });
    await run_workspace(fixture);
    expect(fs.existsSync(path.join(temp_dir, "saved.md"))).toBe(false);
  });

  it("保存目标不能通过真实目录或目录联接写回工作区", async () => {
    const fixture = await create_file_fixture(temp_dir);
    const alias = path.join(temp_dir, "workspace-alias");
    fs.symlinkSync(fixture.workspace_root, alias, "junction");
    for (const target of [fixture.file, path.join(alias, "copy.md")]) {
      fixture.pick_save_path.mockResolvedValueOnce(target);
      await expect(fixture.service.activate_path(fixture.href)).rejects.toMatchObject({
        code: "request.validation_failed",
      });
    }
    expect(fs.readFileSync(fixture.file, "utf8")).toBe("报告");
    expect(fs.existsSync(path.join(fixture.workspace_root, "copy.md"))).toBe(false);
  });

  it("首次 workspace_run 生成只读快照和空 change 文件", async () => {
    const fixture = await create_fixture(temp_dir);
    fs.mkdirSync(path.join(fixture.workspace_root, "stale"), { recursive: true });
    fs.writeFileSync(path.join(fixture.workspace_root, "stale", "partial.json"), "{}");
    await fixture.service.activate_session("test0001", [], async () => {});
    expect(fs.existsSync(path.join(fixture.workspace_root, "stale"))).toBe(true);

    await run_workspace(fixture);

    const first_script = fixture.run.mock.calls[0]![0].scriptPath;
    expect(path.posix.dirname(first_script)).toBe("work/runs");
    expect(fs.readFileSync(path.join(fixture.workspace_root, first_script), "utf8")).toBe(
      VALID_WORKSPACE_SCRIPT,
    );

    const active_path = fixture.active_path();
    expect(read_json(path.join(active_path, AGENT_WORKSPACE_PATHS.projectMeta))).toMatchObject({
      files: [
        {
          file_path: "script.txt",
          file_type: "TXT",
        },
      ],
    });
    expect(
      fs.readFileSync(path.join(fixture.workspace_root, "sources", "script.txt"), "utf-8"),
    ).toBe("源文件正文");
    expect(read_json(path.join(active_path, "contract.json"))).toEqual(AGENT_WORKSPACE_CONTRACT);
    for (const [relative_path, content] of Object.entries(AGENT_WORKSPACE_REFERENCES)) {
      expect(fs.readFileSync(path.join(active_path, relative_path), "utf8")).toBe(content);
    }
    expect(read_jsonl(path.join(active_path, AGENT_WORKSPACE_PATHS.items))).toEqual([
      expect.objectContaining({ item_id: 1, text_type: expect.any(String) }),
      expect.objectContaining({ item_id: 2, text_type: expect.any(String) }),
    ]);
    expect(read_jsonl(path.join(active_path, AGENT_WORKSPACE_PATHS.warnings))).toEqual([
      {
        item_id: 1,
        warnings: [{ code: "GLOSSARY", target_field: "dst" }],
        glossary_applications: [],
      },
    ]);
    expect(read_json(path.join(active_path, AGENT_WORKSPACE_PATHS.prompts))).toEqual({
      translation: { fp: expect.any(String), text: "翻译正文" },
    });
    for (const kind of QUALITY_RULE_KINDS) {
      expect(
        read_jsonl(path.join(active_path, AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind])),
      ).toHaveLength(1);
    }
    for (const relative_path of all_change_paths()) {
      expect(fs.readFileSync(path.join(active_path, relative_path), "utf-8")).toBe("");
    }
    await run_workspace(fixture);
    expect(fixture.active_path()).toBe(active_path);
  });

  it("补齐缺失变更子目录时保留提交意图、工作材料和快照", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    const changes = path.join(fixture.workspace_root, AGENT_WORKSPACE_CHANGE_PATHS.items.updates);
    const work = path.join(fixture.workspace_root, "work", "notes.txt");
    fs.writeFileSync(changes, "pending");
    fs.writeFileSync(work, "notes");
    fs.rmSync(path.join(fixture.workspace_root, "changes/pages"), { recursive: true });

    await run_workspace(fixture);

    expect(fs.readFileSync(changes, "utf8")).toBe("pending");
    expect(fs.readFileSync(work, "utf8")).toBe("notes");
    expect(fs.statSync(path.join(fixture.workspace_root, "changes/pages")).isDirectory()).toBe(
      true,
    );
    expect(fixture.query_warnings).toHaveBeenCalledOnce();
  });

  it("目录被文件占用时报告 IO 定位信息，解除冲突后可再次运行", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    const changes = path.join(fixture.workspace_root, "changes");
    fs.rmSync(changes, { recursive: true });
    fs.writeFileSync(changes, "conflict");

    await expect(run_workspace(fixture)).rejects.toMatchObject({
      code: "file.io_failed",
      public_details: {
        action: "workspace_run",
        phase: "prepare_workspace",
        operation: "mkdir",
        path: expect.stringMatching(/^changes(?:\/items)?$/),
        system_code: expect.any(String),
      },
    });
    expect(fs.readFileSync(changes, "utf8")).toBe("conflict");
    fs.unlinkSync(changes);
    await expect(run_workspace(fixture)).resolves.toBeDefined();
    expect(fixture.query_warnings).toHaveBeenCalledOnce();
  });

  it("重新激活刷新依赖链接并保留工作材料，部署目录保持完整", async () => {
    const fixture = await create_fixture(temp_dir);
    const modules = path.join(fixture.workspace_root, "node_modules");
    const deployed = fs.realpathSync(modules);
    const marker = path.join(deployed, "installed.txt");
    fs.writeFileSync(marker, "installed");
    await run_workspace(fixture);
    await fixture.service.activate_session("test0001", [], async () => {});
    expect(fs.realpathSync(modules)).toBe(deployed);
    expect(fs.readFileSync(marker, "utf8")).toBe("installed");
    expect(fs.existsSync(path.join(fixture.workspace_root, "work"))).toBe(true);
    expect(fs.readFileSync(path.join(fixture.workspace_root, "package.json"), "utf8")).toBe(
      fs.readFileSync(path.join(temp_dir, "runtime", "package.json"), "utf8"),
    );
  });

  it("sources 在激活后按需生成，普通调用复用，文件修订和重新激活后重建", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    expect(fixture.read_asset_content).toHaveBeenCalledOnce();
    await run_workspace(fixture);
    expect(fixture.read_asset_content).toHaveBeenCalledOnce();
    fixture.snapshot.sectionRevisions.files = 2;
    await run_workspace(fixture);
    expect(fixture.read_asset_content).toHaveBeenCalledTimes(2);
    await fixture.service.close();
    await fixture.service.activate_session("test0001", [], async () => {});
    expect(fs.existsSync(path.join(fixture.workspace_root, "sources"))).toBe(false);
    await run_workspace(fixture);
    expect(fixture.read_asset_content).toHaveBeenCalledTimes(3);
  });

  it("目录 rename 不可用时仍能按需生成 sources", async () => {
    const native_fs = new NativeFs();
    vi.spyOn(native_fs, "rename").mockImplementation(() => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    });
    const fixture = await create_fixture(temp_dir, native_fs);

    await expect(
      fixture.service.activate_session("test0001", [], async () => {}),
    ).resolves.toBeUndefined();
    await run_workspace(fixture);
    expect(
      fs.readFileSync(path.join(fixture.workspace_root, "sources", "script.txt"), "utf-8"),
    ).toBe("源文件正文");
  });

  it("work 跨快照、apply 与普通 revision 变化保留，显式 reset 时清理", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    const work_file = path.join(
      fixture.workspace_root,
      AGENT_WORKSPACE_WORK_ROOT,
      "notes",
      "state.json",
    );
    fs.mkdirSync(path.dirname(work_file));
    fs.writeFileSync(work_file, '{"step":1}\n');

    await run_workspace(fixture);
    expect(fs.readFileSync(work_file, "utf-8")).toBe('{"step":1}\n');
    await expect(fixture.service.apply_workspace()).resolves.toMatchObject({ status: "unchanged" });
    expect(fs.readFileSync(work_file, "utf-8")).toBe('{"step":1}\n');

    await run_workspace(fixture);
    fixture.snapshot.sectionRevisions.items = 2;
    await fixture.service.run(VALID_WORKSPACE_SCRIPT, new AbortController().signal);
    expect(fs.readFileSync(work_file, "utf-8")).toBe('{"step":1}\n');

    await fixture.service.close();
    await fixture.service.delete_session("test0001");
    await fixture.service.activate_session("test0001", [], async () => {});
    expect(fs.readdirSync(path.join(fixture.workspace_root, AGENT_WORKSPACE_WORK_ROOT))).toEqual(
      [],
    );
  });

  it("sources 生成失败不阻断工程加载，并由 workspace_run 触发重试", async () => {
    const fixture = await create_fixture(temp_dir);
    fixture.read_asset_content.mockImplementation(() => {
      throw new Error("asset read failed");
    });

    await expect(
      fixture.service.activate_session("test0001", [], async () => {}),
    ).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(fixture.workspace_root, "sources"))).toBe(false);

    fixture.read_asset_content.mockReturnValue(Buffer.from("源文件正文", "utf-8"));
    await run_workspace(fixture);
    expect(fs.existsSync(path.join(fixture.workspace_root, "sources", "script.txt"))).toBe(true);
  });

  it("stale 快照的数据读取失败时保留此前完整快照与兼容 work", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    const previous_path = fixture.active_path();
    const work_file = path.join(fixture.workspace_root, AGENT_WORKSPACE_WORK_ROOT, "state.json");
    fs.writeFileSync(work_file, "state");
    fixture.snapshot.sectionRevisions.items = 2;
    fixture.query_warnings.mockRejectedValueOnce(new Error("warning query failed"));

    await expect(run_workspace(fixture)).rejects.toMatchObject({
      code: "runtime.internal_invariant",
      public_details: { phase: "prepare_snapshot" },
      cause: expect.objectContaining({ message: "warning query failed" }),
    });
    expect(fixture.active_path()).toBe(previous_path);
    expect(fs.readFileSync(work_file, "utf-8")).toBe("state");
    await fixture.service.run(VALID_WORKSPACE_SCRIPT, new AbortController().signal);
  });

  it("并行落盘失败会等待其它写入结算后再清理半成品", async () => {
    const native_fs = new NativeFs();
    let release_delayed_write = (): void => undefined;
    const delayed_write_release = new Promise<void>((resolve) => {
      release_delayed_write = resolve;
    });
    let mark_delayed_write_started = (): void => undefined;
    const delayed_write_started = new Promise<void>((resolve) => {
      mark_delayed_write_started = resolve;
    });
    let delayed_write_pending = false;
    let cleanup_started_while_write_pending = false;
    const original_write_file = native_fs.write_file.bind(native_fs);
    vi.spyOn(native_fs, "write_file").mockImplementation(async (file_path, content) => {
      const normalized_path = file_path.replaceAll("\\", "/");
      if (normalized_path.endsWith(AGENT_WORKSPACE_CONTRACT.datasets.items!.reference)) {
        delayed_write_pending = true;
        mark_delayed_write_started();
        await delayed_write_release;
        await original_write_file(file_path, content);
        delayed_write_pending = false;
        return;
      }
      if (file_path.endsWith(AGENT_WORKSPACE_PATHS.contract)) {
        await delayed_write_started;
        throw new Error("contract write failed");
      }
      await original_write_file(file_path, content);
    });
    const original_remove_async = native_fs.remove_async.bind(native_fs);
    vi.spyOn(native_fs, "remove_async").mockImplementation(async (target_path, options) => {
      if (delayed_write_pending) cleanup_started_while_write_pending = true;
      await original_remove_async(target_path, options);
    });
    const fixture = await create_fixture(temp_dir, native_fs);

    const environment_files = fs.readdirSync(fixture.workspace_root);
    const script = run_workspace(fixture);
    await delayed_write_started;
    await new Promise<void>((resolve) => setImmediate(resolve));
    release_delayed_write();

    await expect(script).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "contract write failed" }),
    });
    expect(cleanup_started_while_write_pending).toBe(false);
    expect(fs.readdirSync(fixture.workspace_root).sort()).toEqual(
      [...environment_files, "sources"].sort(),
    );
  });

  it("脚本错误和 runtime 故障保留已经写入的工作文件与阶段", async () => {
    const fixture = await create_fixture(temp_dir);
    let doing: string | null = null;
    const write_doing = (text: string | null): void => {
      doing = text;
    };
    await run_workspace(fixture);
    const active_path = fixture.active_path();
    const work_file = path.join(fixture.workspace_root, AGENT_WORKSPACE_WORK_ROOT, "state.json");
    fs.writeFileSync(work_file, "state");
    fixture.run.mockImplementationOnce(async (request) => {
      request.doing!("检查章节");
      throw new AgentWorkspaceRunError("脚本失败", {
        ...workspace_execution({ completed: 1 }, { message: "脚本失败" }),
        exitCode: 1,
      });
    });

    await expect(
      fixture.service.run("throw new Error();", new AbortController().signal, write_doing),
    ).rejects.toMatchObject({
      public_details: {
        action: "workspace_run",
        stdout: { content: { completed: 1 } },
        stderr: { content: { message: "脚本失败" } },
      },
    });
    const { scriptPath } = fixture.run.mock.lastCall![0];
    expect(path.posix.dirname(scriptPath)).toBe(AGENT_WORKSPACE_RUN_ROOT);
    expect(path.posix.basename(scriptPath)).toMatch(/^[0-9A-Za-z]{12}\.mjs$/u);
    const run_path = scriptPath.slice(0, -".mjs".length);
    expect(fixture.run).toHaveBeenLastCalledWith(
      {
        workspacePath: active_path,
        scriptPath,
        stdoutPath: `${run_path}.stdout.log`,
        stderrPath: `${run_path}.stderr.log`,
        doing: write_doing,
        host: expect.any(Function),
        emitImage: expect.any(Function),
      },
      expect.any(AbortSignal),
    );
    expect(fixture.active_path()).not.toBe("");
    expect(fs.readFileSync(work_file, "utf-8")).toBe("state");

    expect(doing).toBe("检查章节");
    fixture.run.mockRejectedValueOnce(new Error("host disconnected"));
    await expect(
      fixture.service.run(VALID_WORKSPACE_SCRIPT, new AbortController().signal),
    ).rejects.toMatchObject({ public_details: { action: "workspace_run" } });
    expect(fixture.active_path()).not.toBe("");
    expect(fs.readFileSync(work_file, "utf-8")).toBe("state");

    fixture.run.mockRejectedValueOnce(
      Object.assign(new Error("missing runtime"), {
        code: "ENOENT",
        syscall: "realpath",
        path: path.join(temp_dir, "runtime", "missing"),
      }),
    );
    const failure = await run_workspace(fixture).catch((error: unknown) => error);
    expect(failure).toEqual(
      expect.objectContaining({
        code: "file.not_found",
        public_details: {
          action: "workspace_run",
          phase: "execute",
          operation: "realpath",
          system_code: "ENOENT",
        },
      }),
    );
  });

  it("apply 只提交显式 change，成功后销毁快照并保留 work", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    const work_file = path.join(
      fixture.workspace_root,
      AGENT_WORKSPACE_WORK_ROOT,
      "notes",
      "state.json",
    );
    fs.mkdirSync(path.dirname(work_file));
    fs.writeFileSync(work_file, "state");
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 2, fp: item_fp(fixture.active_path(), 2), dst: "译文-2" },
    ]);
    write_rows(fixture.active_path(), AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.updates, [
      {
        id: "glossary-1",
        fp: quality_fp(fixture.active_path(), "glossary", "glossary-1"),
        dst: "姬",
      },
    ]);
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates, [
      {
        kind: "translation",
        fp: prompt_fp(fixture.active_path(), "translation"),
        text: "新翻译正文",
      },
    ]);

    const request_approval = vi.fn(async () => undefined);
    await expect(fixture.service.apply_workspace(request_approval)).resolves.toEqual({
      status: "applied",
      applied: {
        items: { updated: 1 },
        quality: { glossary: { created: 0, updated: 1, deleted: 0 } },
        prompts: { updated: ["translation"] },
      },
      rejected: [],
      destroyed: true,
      revisions: { items: 2, proofreading: 2, quality: 2, prompts: 2, pdf: 0 },
    });
    expect(request_approval).toHaveBeenCalledWith({
      pages: 0,
      items: 1,
      glossary: 1,
      textPreserve: 0,
      preReplacement: 0,
      postReplacement: 0,
      prompts: 1,
    });
    expect(fixture.write_store).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: "test.lg",
        source: "agent_workspace_apply",
        batch: expect.objectContaining({
          items: [expect.objectContaining({ item_id: 2, update: { dst: "译文-2" } })],
          prompts: [expect.objectContaining({ kind: "translation", text: "新翻译正文" })],
        }),
      }),
    );
    expect(fixture.active_path()).toBe("");
    expect(fs.readFileSync(work_file, "utf-8")).toBe("state");

    await run_workspace(fixture);
    for (const relative_path of all_change_paths()) {
      expect(fs.readFileSync(path.join(fixture.active_path(), relative_path), "utf-8")).toBe("");
    }
    expect(fs.readFileSync(work_file, "utf-8")).toBe("state");
    await expect(fixture.service.apply_workspace()).resolves.toMatchObject({ status: "unchanged" });
    expect(fixture.write_store).toHaveBeenCalledOnce();
  });

  it("部分成功只保留规范化后的拒绝并按实际对象生成状态", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    const work_file = path.join(fixture.workspace_root, AGENT_WORKSPACE_WORK_ROOT, "state.json");
    fs.writeFileSync(work_file, "state");
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, fp: item_fp(fixture.active_path(), 1), dst: "译文" },
    ]);
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates, [
      { kind: "translation", fp: "AAAA", text: "新翻译正文" },
    ]);

    await expect(fixture.service.apply_workspace()).resolves.toMatchObject({
      status: "partial",
      applied: { items: { updated: 1 } },
      rejected: [{ scope: "prompts", op: "update", kind: "translation", reason: "invalid_change" }],
      destroyed: true,
    });
    expect(fs.readFileSync(work_file, "utf-8")).toBe("state");
  });

  it("审批拒绝不触达项目写入口并保留已准备工作区", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, fp: item_fp(fixture.active_path(), 1), dst: "译文" },
    ]);

    await expect(
      fixture.service.apply_workspace(async () => {
        throw new Error("denied");
      }),
    ).rejects.toThrow("denied");
    expect(fixture.write_store).not.toHaveBeenCalled();
    expect(fixture.active_path()).not.toBe("");
  });

  it("对象内冲突返回 rejected 并保留工作区供脚本修复", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, fp: item_fp(fixture.active_path(), 1), dst: "甲" },
      { item_id: 1, fp: item_fp(fixture.active_path(), 1), dst: "乙" },
    ]);

    await expect(fixture.service.apply_workspace()).resolves.toMatchObject({
      status: "rejected",
      rejected: [{ scope: "items", op: "update", id: 1, reason: "merge_conflict" }],
      destroyed: false,
    });
    expect(fixture.active_path()).not.toBe("");

    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, fp: item_fp(fixture.active_path(), 1), dst: "甲" },
    ]);
    await expect(fixture.service.apply_workspace()).resolves.toMatchObject({ status: "applied" });
  });

  it("未匹配活动基线的 quality 与 prompt fp 归为输入错误并保留工作区", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    write_rows(fixture.active_path(), AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.updates, [
      { id: "glossary-1", fp: "AAAA", dst: "姬" },
    ]);
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates, [
      { kind: "translation", fp: "BBBB", text: "新翻译正文" },
    ]);

    await expect(fixture.service.apply_workspace()).resolves.toMatchObject({
      status: "rejected",
      rejected: expect.arrayContaining([
        {
          scope: "quality",
          kind: "glossary",
          op: "update",
          id: "glossary-1",
          reason: "invalid_change",
        },
        { scope: "prompts", op: "update", kind: "translation", reason: "invalid_change" },
      ]),
      destroyed: false,
    });
    expect(fixture.write_store).not.toHaveBeenCalled();
    expect(fixture.active_path()).not.toBe("");
  });

  it("数据库回滚失败保留工作区并允许安全重试", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, fp: item_fp(fixture.active_path(), 1), dst: "译文" },
    ]);
    fixture.write_store.mockRejectedValueOnce(new Error("database failed"));

    await expect(fixture.service.apply_workspace()).rejects.toMatchObject({
      public_details: { action: "workspace_apply" },
    });
    expect(fixture.active_path()).not.toBe("");
    await expect(fixture.service.apply_workspace()).resolves.toMatchObject({ status: "applied" });
  });

  it("目标事实漂移销毁快照、保留 work 并拒绝旧对象写入", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    const work_file = path.join(fixture.workspace_root, AGENT_WORKSPACE_WORK_ROOT, "state.json");
    fs.writeFileSync(work_file, "state");
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, fp: item_fp(fixture.active_path(), 1), dst: "译文" },
    ]);
    fixture.items[0]!.dst = "外部译文";

    await expect(fixture.service.apply_workspace()).resolves.toMatchObject({
      status: "rejected",
      rejected: [{ scope: "items", op: "update", id: 1, reason: "fp_mismatch" }],
      destroyed: true,
    });
    expect(fixture.write_store).not.toHaveBeenCalled();
    expect(fixture.active_path()).toBe("");
    expect(fs.readFileSync(work_file, "utf-8")).toBe("state");
    await run_workspace(fixture);
    expect(
      read_jsonl(path.join(fixture.active_path(), AGENT_WORKSPACE_PATHS.items))[0],
    ).toMatchObject({
      dst: "外部译文",
    });
    expect(fs.readFileSync(work_file, "utf-8")).toBe("state");
  });

  it("提交后同步失败保留 committed 事实、销毁快照并保留 work", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    const work_file = path.join(fixture.workspace_root, AGENT_WORKSPACE_WORK_ROOT, "state.json");
    fs.writeFileSync(work_file, "state");
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, fp: item_fp(fixture.active_path(), 1), dst: "译文" },
    ]);
    fixture.write_store.mockRejectedValueOnce(
      new AppErrors.AppError("data.committed_sync_failed", {
        public_details: { committed: true, action: "reload_project" },
      }),
    );

    await expect(fixture.service.apply_workspace()).rejects.toMatchObject({
      code: "data.committed_sync_failed",
      public_details: { committed: true, action: "reload_project" },
    });
    expect(fixture.active_path()).toBe("");
    expect(fs.readFileSync(work_file, "utf-8")).toBe("state");
  });

  it("无真实 change 不触达项目写入口并保留工作区", async () => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);

    const request_approval = vi.fn(async () => undefined);
    await expect(fixture.service.apply_workspace(request_approval)).resolves.toEqual({
      status: "unchanged",
      applied: {},
      rejected: [],
      destroyed: false,
      revisions: { items: 1, proofreading: 1, quality: 1, prompts: 1, pdf: 0 },
    });
    expect(request_approval).not.toHaveBeenCalled();
    expect(fixture.write_store).not.toHaveBeenCalled();
    expect(fixture.active_path()).not.toBe("");
  });

  it("workspace_run 派生数据读取期间 revision 漂移时拒绝生成混合快照", async () => {
    const fixture = await create_fixture(temp_dir);
    const query_warnings = fixture.query_warnings.getMockImplementation();
    if (query_warnings === undefined) throw new Error("缺少校对查询 fixture");
    fixture.query_warnings.mockImplementationOnce(async () => {
      const result = await query_warnings();
      fixture.snapshot.sectionRevisions.items = 2;
      return result;
    });
    const environment_files = fs.readdirSync(fixture.workspace_root);

    await expect(run_workspace(fixture)).rejects.toMatchObject({
      public_details: { action: "workspace_run" },
    });
    expect(fs.readdirSync(fixture.workspace_root)).toEqual(environment_files);
  });

  it.each(PROJECT_DATA_SECTIONS)("%s revision 变化会替换旧快照", async (section) => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    const change_file = path.join(
      fixture.active_path(),
      AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
    );
    fs.writeFileSync(change_file, "pending");
    fixture.snapshot.sectionRevisions[section] = 2;

    await fixture.service.run(VALID_WORKSPACE_SCRIPT, new AbortController().signal);
    expect(fs.readFileSync(change_file, "utf-8")).toBe("");
  });

  it.each(["epoch", "language"] as const)("%s 变化刷新快照并保留已有 work", async (field) => {
    const fixture = await create_fixture(temp_dir);
    await run_workspace(fixture);
    const work_file = path.join(fixture.workspace_root, AGENT_WORKSPACE_WORK_ROOT, "state.json");
    fs.writeFileSync(work_file, "state");
    if (field === "epoch") fixture.snapshot.epoch += 1;
    else fixture.setting.target_language = "EN";
    fixture.query_warnings.mockRejectedValueOnce(new Error("warning query failed"));

    await expect(run_workspace(fixture)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "warning query failed" }),
    });
    expect(fs.readFileSync(work_file, "utf8")).toBe("state");

    await fixture.service.run(VALID_WORKSPACE_SCRIPT, new AbortController().signal);
    expect(fs.readFileSync(work_file, "utf8")).toBe("state");
  });
});

/** 通过公开脚本入口按需建立或刷新工作区。 */
async function run_workspace(
  fixture: Awaited<ReturnType<typeof create_fixture>>,
): ReturnType<AgentWorkspaceService["run"]> {
  return await fixture.service.run(VALID_WORKSPACE_SCRIPT, new AbortController().signal);
}

/** 用真实磁盘工作区替换宿主脚本端口，其余协作者保持最小可观察 fake。 */
async function create_fixture(temp_dir: string, native_fs?: NativeFs) {
  const workspace_parent = path.join(temp_dir, "workspaces");
  const workspace_root = path.join(workspace_parent, "test0001");
  const revisions = Object.fromEntries(
    ["project", "files", "items", "quality", "prompts", "proofreading"].map((section) => [
      section,
      1,
    ]),
  ) as ProjectDataSectionRevisions;
  const snapshot = {
    projectPath: "test.lg",
    epoch: 1,
    freshness: "fresh" as const,
    sectionRevisions: { ...revisions },
    itemCount: 2,
  };
  const items = [create_item(1), create_item(2)];
  const item_by_id = new Map(items.map((item) => [item.item_id, item]));
  const quality = create_empty_quality_rule_block();
  quality.glossary.entries = normalize_quality_rule_entries(QualityRule.from_json("glossary"), [
    create_quality_entry("glossary"),
  ]);
  quality.pre_replacement.entries = normalize_quality_rule_entries(
    QualityRule.from_json("pre_replacement"),
    [create_quality_entry("pre_replacement")],
  );
  quality.post_replacement.entries = normalize_quality_rule_entries(
    QualityRule.from_json("post_replacement"),
    [create_quality_entry("post_replacement")],
  );
  quality.text_preserve.entries = normalize_quality_rule_entries(
    QualityRule.from_json("text_preserve"),
    [create_quality_entry("text_preserve")],
  );
  const cache: CacheReadPort = {
    items: {
      readItems: () => items,
      readItem: (item_id) => item_by_id.get(item_id) ?? null,
    },
    files: {
      readFileEntries: () => [{ rel_path: "script.txt", file_type: "TXT", sort_index: 0 }],
    },
    quality: { readBlock: () => quality },
    prompts: {
      readBlock: () => ({
        translation: { enabled: true, text: "翻译正文", revision: 1 },
      }),
    },

    readSectionRevisions: () => ({ ...snapshot.sectionRevisions }),
    snapshot: () => ({ ...snapshot, sectionRevisions: { ...snapshot.sectionRevisions } }),
  };
  const run = vi.fn<AgentWorkspaceRunPort>(async () => workspace_execution());
  const write_store = vi.fn<ProjectWriteStore["apply_agent_workspace_changes"]>(async (request) => {
    const outcome = resolve_agent_workspace_writes({
      batch: request.batch,
      current: {
        pdfDocuments: [],
        items: items as unknown as JsonRecord[],
        quality: Object.fromEntries(
          QUALITY_RULE_KINDS.map((kind) => [
            kind,
            read_json_record(quality[kind])["entries"] as JsonRecord[],
          ]),
        ),
        prompts: { translation: "翻译正文" },
        duplicateFilterEnabled: false,
      },
    });
    const destroyed =
      has_agent_workspace_applied_changes(outcome.applied) ||
      outcome.rejected.some(
        (rejection) => rejection.reason === "fp_mismatch" || rejection.reason === "target_missing",
      );
    return {
      applied: outcome.applied,
      rejected: outcome.rejected,
      destroyed,
      sectionRevisions: {
        ...revisions,
        ...(outcome.itemChanges.length === 0 ? {} : { items: 2, proofreading: 2 }),
        ...(outcome.qualityChanges.length === 0 ? {} : { quality: 2 }),
        ...(outcome.promptChanges.length === 0 ? {} : { prompts: 2 }),
      },
    };
  });
  const runtime_gate = vi.fn(async (operation: () => ReturnType<typeof write_store>) =>
    operation(),
  );
  const warning_item = items[0] as JsonRecord;
  const setting = { ...DEFAULT_SETTING };
  const read_asset_content = vi.fn(() => Buffer.from("源文件正文", "utf-8"));
  const query_warnings = vi.fn(async () => ({
    projectPath: snapshot.projectPath,
    sectionRevisions: { ...snapshot.sectionRevisions },
    data: {
      total_item_count: 1,
      items: [
        {
          item_id: 1,
          file_path: "script.txt",
          internal_file_path: null,
          row_number: 0,
          src: String(warning_item["src"]),
          dst: "",
          name_src: null,
          name_dst: null,
          status: "NONE" as const,
          retry_count: 0,
          row_id: "item:1",
          compressed_src: String(warning_item["src"]),
          compressed_dst: "",
          warnings: [{ code: "GLOSSARY" as const, target_field: "dst" as const }],
          glossary_applications: [],
        },
      ],
    },
  }));
  const open_directory = vi.fn(async (_path: string) => undefined);
  const pick_save_path = vi.fn(async (_default_name: string): Promise<string | null> => null);
  const prepare_image = vi.fn<AgentImageService["prepare"]>(async (bytes, _signal, options) => ({
    data: Buffer.from(bytes).toString("base64"),
    mimeType: "image/webp",
    width: options?.maxEdge ?? 1,
    height: 1,
    originalWidth: 1,
    originalHeight: 1,
  }));
  const service = new AgentWorkspaceService({
    images: { prepare: prepare_image },
    runtimeDirectory: create_workspace_runtime_fixture(temp_dir),
    paths: {
      get_agent_workspace_root_dir: () => workspace_parent,
    },
    settings: { read_setting: () => ({ ...setting }) },
    sessionState: { require_loaded_project_path: () => snapshot.projectPath },
    cache,
    proofreading: { query_warnings },
    database: {
      get_all_meta: () => ({}),
      read_asset_content,
      read_pdf_document: () => null,
      read_pdf_documents: () => [],
      read_file_counts: () => new Map(),
    },
    runtimeGate: { run_agent_project_write: runtime_gate },
    writeStore: { apply_agent_workspace_changes: write_store },
    logManager: { warning: vi.fn() },
    run,
    openDirectory: open_directory,
    pickSavePath: pick_save_path,
    ...(native_fs === undefined ? {} : { nativeFs: native_fs }),
  });
  await service.initialize();
  await service.activate_session("test0001", [], async () => {});
  return {
    service,
    prepare_image,
    open_directory,
    pick_save_path,
    workspace_root,
    snapshot,
    setting,
    query_warnings,
    run,
    write_store,
    items,
    read_asset_content,
    active_path: () =>
      fs.existsSync(path.join(workspace_root, AGENT_WORKSPACE_PATHS.contract))
        ? workspace_root
        : "",
  };
}

/** 构造工作区投影和 change 准备共同使用的公开 item。 */
function create_item(item_id: number): ProjectItemPublicRecord {
  return {
    item_id,
    src: `原文-${item_id.toString()}`,
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: item_id - 1,
    file_type: "TXT",
    file_path: "script.txt",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
  };
}

/** 四类 quality 复用稳定身份骨架，各自只补真实领域字段。 */
function create_quality_entry(kind: QualityRuleKind): JsonRecord {
  const common = { entry_id: `${kind}-1`, src: kind === "glossary" ? "姫" : "公主" };
  if (kind === "glossary") return { ...common, dst: "公主", info: "称谓", case_sensitive: false };
  if (kind === "text_preserve") return { ...common, info: "保护" };
  return { ...common, dst: "殿下", regex: false, case_sensitive: false };
}

/** 测试读取固定 JSON 文件，不参与生产解析语义。 */
function read_json(file_path: string): JsonRecord {
  return JSON.parse(fs.readFileSync(file_path, "utf-8")) as JsonRecord;
}

/** 测试读取固定 JSONL 文件，并忽略合法空行。 */
function read_jsonl(file_path: string): JsonRecord[] {
  return fs
    .readFileSync(file_path, "utf-8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as JsonRecord);
}

/** 从真实 snapshot 复制 item fp，模拟模型只回传已见身份。 */
function item_fp(workspace_path: string, item_id: number): string {
  const row = read_jsonl(path.join(workspace_path, AGENT_WORKSPACE_PATHS.items)).find(
    (item) => item["item_id"] === item_id,
  );
  return String(row?.["fp"] ?? "");
}

/** 从对应 quality 数据集复制既有 entry fp。 */
function quality_fp(workspace_path: string, kind: QualityRuleKind, entry_id: string): string {
  const row = read_jsonl(path.join(workspace_path, AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind])).find(
    (entry) => entry["id"] === entry_id,
  );
  return String(row?.["fp"] ?? "");
}

/** prompts.json 以对象形式暴露每个 kind 的 fp 与正文。 */
function prompt_fp(workspace_path: string, kind: "translation" | "analysis"): string {
  const prompts = read_json(path.join(workspace_path, AGENT_WORKSPACE_PATHS.prompts));
  return String(read_json_record(prompts[kind])["fp"] ?? "");
}

/** 直接准备显式提交批次，文件读写权限由真实 Node 测试负责。 */
function write_rows(workspace_path: string, relative_path: string, rows: JsonRecord[]): void {
  fs.writeFileSync(
    path.join(workspace_path, relative_path),
    rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf-8",
  );
}

/** 测试初始化与生产 snapshot 共享同一固定 change 路径集合。 */
function all_change_paths(): string[] {
  return [
    AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
    AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates,
    ...QUALITY_RULE_KINDS.flatMap((kind) =>
      AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS.map(
        (operation) => AGENT_WORKSPACE_QUALITY_CHANGE_PATHS[kind][operation],
      ),
    ),
  ];
}

/** 使用真实工作文件与宿主选择结果观察保存边界。 */
async function create_file_fixture(temp_dir: string) {
  const fixture = await create_fixture(temp_dir);
  await fixture.service.initialize();
  await fixture.service.activate_session("test0001", [], async () => {});
  const file = path.join(fixture.workspace_root, "work", "结果 # %23.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "报告");
  const destination = path.join(temp_dir, "saved.md");
  fixture.pick_save_path.mockResolvedValue(destination);
  return { ...fixture, file, destination, href: "work/结果%20%23%20%2523.md" };
}

it("PDF 零条目工程按页保存、隔离旧指纹，语言变化后重建工作区继续并通过统一入口导出", async () => {
  using directory = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-pdf-workspace-"));
  fs.writeFileSync(path.join(directory.path, "version.txt"), "0.0.0");
  const source = path.join(directory.path, "book.pdf");
  fs.writeFileSync(
    source,
    create_pdf_fixture(["Same extracted text", "Same extracted text", null]),
  );
  const resources = await BackendResources.start({
    appRoot: directory.path,
    builtinRoot: path.join(directory.path, "builtin"),
    logTargets: { console: false, window: false },
    systemProxyResolver: { resolveProxy: async () => "DIRECT" },
  });
  const pdfHost = vi.fn<PDFHost>(async () => create_pdf_fixture(["Translated page"]));
  const services = new BackendServices({
    paths: resources.paths,
    metadata: resources.metadata,
    appSettingService: resources.settings,
    database: resources.database,
    logManager: resources.logManager,
    publishEvent: () => {},
    openOutputFolder: async () => {},
    pdfHost,
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
      run: async () => workspace_execution(),
      runtimeDirectory: create_workspace_runtime_fixture(directory.path),
      openDirectory: async () => {},
      pickSavePath: async () => null,
    });
    expect(workspace.list_files()).toEqual([
      { kind: "workspace", path: "book.pdf", count: 3, unit: "pages" },
    ]);
    await workspace.initialize();
    await workspace.activate_session("test0001", [], async () => {});
    const upload = await workspace.uploads.upload(
      "参考.txt",
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("资料"));
          controller.close();
        },
      }),
      new AbortController().signal,
    );
    expect(workspace.list_files()).toContainEqual({ kind: "upload", path: upload.path, size: 6 });
    await workspace.run("", new AbortController().signal);
    const root = path.join(resources.paths.get_agent_workspace_root_dir(), "test0001");
    const project_path = services.state.session.require_loaded_project_path();
    // 每次从数据库重读，验证保存与重开后的事实而非缓存引用。
    const read_document = () => resources.database.read_pdf_document(project_path, "book.pdf")!;
    expect(resources.database.get_item_count(project_path)).toBe(0);
    expect(services.state.cache.files.readFileEntries()).toEqual([
      { rel_path: "book.pdf", file_type: "PDF", sort_index: 0 },
    ]);
    const contract = JSON.parse(fs.readFileSync(path.join(root, "contract.json"), "utf8"));
    const page_rows = fs
      .readFileSync(path.join(root, contract.datasets.pages.path), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(page_rows.map(({ file_path, page }) => ({ file_path, page }))).toEqual(
      [1, 2, 3].map((page) => ({ file_path: "book.pdf", page })),
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "project_meta.json"), "utf8")).counts,
    ).toMatchObject({ items: 0, pages: page_rows.length });
    const source_path = path.join(root, "sources/book.pdf");
    const source_mtime = fs.statSync(source_path).mtimeMs;
    const draft = {
      translation: { kind: "translate" as const, markdown: "跨页段落\n\n图中是蓝色矩形。" },
      reviewed: true,
      notes: "等待版式核对",
    };
    const original = read_document();
    const original_fp = agent_workspace_page_fingerprint(
      "book.pdf",
      original.digest,
      original.pages[0]!,
    );
    const second_fp = agent_workspace_page_fingerprint(
      "book.pdf",
      original.digest,
      original.pages[1]!,
    );
    const request_approval = vi.fn(async () => undefined);
    // 通过真实 JSONL 接口提交单页，保留其它页的持久状态。
    const save = async (fp: string, update: PDFPageUpdate, page = 1) => {
      fs.writeFileSync(
        path.join(root, contract.changes.pages.updates.path),
        JSON.stringify({ file_path: "book.pdf", page, fp, ...update }),
      );
      return workspace.apply_workspace(request_approval);
    };
    const before = services.state.cache.snapshot();
    expect((await save(original_fp, draft))["status"]).toBe("applied");
    expect(request_approval).toHaveBeenCalledExactlyOnceWith({
      pages: 1,
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
    await workspace.run("", new AbortController().signal);
    expect(fs.statSync(source_path).mtimeMs).toBe(source_mtime);
    expect((await save(original_fp, { ...draft, notes: "stale" }))["status"]).toBe("rejected");
    expect(read_document().pages[0]!.notes).toBe("等待版式核对");
    await workspace.run("", new AbortController().signal);
    const baseline = read_document();
    const baseline_fp = agent_workspace_page_fingerprint(
      "book.pdf",
      baseline.digest,
      baseline.pages[0]!,
    );
    // 快照后其它写入者修改同一页，工作区应保留真实漂移的页级拒绝原因。
    await services.state.writes.apply_agent_workspace_changes({
      projectPath: project_path,
      source: "agent_workspace_apply",
      batch: {
        ...create_empty_agent_workspace_intent_batch(),
        pages: [
          { file_path: "book.pdf", page: 1, fp: baseline_fp, line: 1, ...draft, reviewed: false },
        ],
      },
    });
    fs.writeFileSync(
      path.join(root, contract.changes.pages.updates.path),
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
    expect(partial["applied"]).toEqual({ pages: { updated: 1 } });
    expect(partial["rejected"]).toMatchObject([
      { scope: "pages", file_path: "book.pdf", page: 1, reason: "fp_mismatch" },
    ]);
    expect(read_document().pages[0]!.notes).toBe("等待版式核对");
    expect(read_document().pages[2]).toEqual(original.pages[2]);
    await workspace.run("", new AbortController().signal);
    expect(
      (
        await save(
          agent_workspace_page_fingerprint("book.pdf", original.digest, original.pages[2]!),
          {
            translation: { kind: "keep", reason: "已查看纯图页，无需翻译" },
            reviewed: true,
            notes: "",
          },
          3,
        )
      )["status"],
    ).toBe("applied");
    await workspace.initialize();
    resources.settings.set_transient_overrides({ source_language: "ALL", target_language: "DE" });
    resources.database.upsert_meta_entries(project_path, {
      source_language: "ALL",
      target_language: "DE",
    });
    resources.database.close_project(project_path);
    await workspace.run("", new AbortController().signal);
    const rows = fs
      .readFileSync(path.join(root, "pages/entries.jsonl"), "utf8")
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
    expect(rows[2].translation).toEqual({ kind: "keep", reason: "已查看纯图页，无需翻译" });
    expect(services.project.summary.read().snapshot.entries[0]!.progress).toMatchObject({
      completed_count: 2,
      skipped_count: 1,
      pending_count: 0,
      completion_percent: 100,
    });
    draft.notes = "重新读取工程设置后继续核对";
    draft.translation.markdown = "核对后的最新译稿";
    expect(
      (
        await save(
          agent_workspace_page_fingerprint(
            "book.pdf",
            read_document().digest,
            read_document().pages[0]!,
          ),
          draft,
        )
      )["status"],
    ).toBe("applied");
    const output = await services.files.translationExport.export_files();
    expect(pdfHost.mock.calls[0]?.[0].html).toContain(draft.translation.markdown);
    expect(output.pdf_files).toEqual([
      { file_path: "book.pdf", translated_pages: 2, original_pages: 1, omitted_pages: 0 },
    ]);
    const exported = read_pdf_document(
      new Uint8Array(fs.readFileSync(path.join(output.output_path, "book.pdf"))),
    );
    expect(exported.pages).toHaveLength(2);
    expect(read_document().pages[0]).toMatchObject(draft);
    // 重置和删除使用当前 revision，避免沿用先前提交的快照。
    const revision = () =>
      new ProjectDataReader(resources.database).build_manifest({
        loaded: true,
        projectPath: project_path,
      })["sectionRevisions"];
    await services.project.content.reset_files({
      rel_paths: ["book.pdf"],
      expected_section_revisions: revision()!,
    });
    expect(
      read_document().pages.every(
        (page) => page.translation === null && !page.reviewed && page.notes === "",
      ),
    ).toBe(true);
    expect(read_document().pages).toHaveLength(3);
    await services.project.content.delete_files({
      rel_paths: ["book.pdf"],
      expected_section_revisions: revision()!,
    });
    expect(resources.database.read_pdf_document(project_path, "book.pdf")).toBeNull();
    expect(resources.database.read_asset_content(project_path, "book.pdf")).toBeNull();
  } finally {
    await services.dispose();
    await resources.dispose();
  }
});

it("警告投影满足字段契约并只输出关联证据", () => {
  const warnings: ProofreadingWarning[] = [
    { code: "FOREIGN_CHAR_RESIDUE", target_field: "name_dst", fragments: ["かな"] },
    {
      code: "TEXT_PRESERVE",
      target_field: "name_dst",
      source_fragments: ["{PLAYER}"],
      translation_fragments: [],
    },
    { code: "PUNCTUATION_MISMATCH", target_field: "name_dst" },
    { code: "SIMILARITY", target_field: "dst" },
    { code: "LINE_COUNT_MISMATCH", target_field: "dst" },
    { code: "RETRY_THRESHOLD", target_field: null },
  ];
  const output = project_agent_workspace_warning({
    item_id: 1,
    row_id: "1",
    file_path: "a.txt",
    internal_file_path: null,
    row_number: 1,
    src: "原文",
    dst: "译文",
    name_src: "Alice",
    name_dst: "かな",
    status: "PROCESSED",
    retry_count: 2,
    compressed_src: "原文",
    compressed_dst: "译文",
    glossary_applications: [],
    warnings,
  });
  expect(Check(AGENT_WORKSPACE_WARNING_SCHEMA, output)).toBe(true);
  expect(output).toEqual({ item_id: 1, warnings, glossary_applications: [] });
  expect(
    Check(AGENT_WORKSPACE_WARNING_SCHEMA, {
      ...output,
      warnings: [{ code: "SIMILARITY", target_field: "name_dst" }],
    }),
  ).toBe(false);
});
