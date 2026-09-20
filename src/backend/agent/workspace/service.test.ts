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
  has_agent_workspace_applied_changes,
  resolve_agent_workspace_writes,
} from "../../project/agent-workspace-write";
import { AgentWorkspaceService, type AgentWorkspaceRunPort } from "./service";
import {
  AGENT_WORKSPACE_CHANGE_PATHS,
  AGENT_WORKSPACE_CONTRACT,
  AGENT_WORKSPACE_REFERENCES,
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS,
  AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
  AGENT_WORKSPACE_QUALITY_ENTRY_PATHS,
} from "./contract";
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
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    fixture.run.mockImplementationOnce(async (request, signal) => {
      const file = path.join(request.workspacePath, "work", "页面 # %23.webp");
      fs.writeFileSync(file, "first");
      await request.emitImage!("work/页面 # %23.webp", signal);
      fs.writeFileSync(file, "second");
      await request.emitImage!("work/页面 # %23.webp", signal, { maxEdge: 3840 });
      fs.unlinkSync(file);
      await expect(request.emitImage!("../outside.webp", signal)).rejects.toBeDefined();
      return { execution: workspace_execution(), todos: [] };
    });
    const result = await fixture.service.run(
      VALID_WORKSPACE_SCRIPT,
      [],
      new AbortController().signal,
    );
    expect(result.images.map(({ image }) => Buffer.from(image.data, "base64").toString())).toEqual([
      "first",
      "second",
    ]);
    expect(result.images.map(({ image }) => image.width)).toEqual([1, 3840]);
  });

  it("图片数量超限提供恢复信息，后续程序可继续输出现有文件", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    const limit = AGENT_WORKSPACE_RUNTIME_POLICY.imageCount;
    const image_path = "work/image.webp";
    fixture.run.mockImplementationOnce(async (request, signal) => {
      fs.writeFileSync(path.join(request.workspacePath, image_path), "image");
      for (let i = 0; i < limit; i++) await request.emitImage!(image_path, signal);
      await expect(request.emitImage!(image_path, signal)).rejects.toThrow(image_path);
      return { execution: workspace_execution(), todos: [] };
    });
    expect((await run_workspace(fixture)).images).toHaveLength(limit);
    fixture.run.mockImplementationOnce(async (request, signal) => {
      await request.emitImage!(image_path, signal);
      return { execution: workspace_execution(), todos: [] };
    });
    expect((await run_workspace(fixture)).images).toHaveLength(1);
  });

  it("累计大小超限释放占位且不占额度，捕获后可补足额度并在下一次程序重新输出", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    const limit = AGENT_WORKSPACE_RUNTIME_POLICY.imageOutputBytes;
    const count = AGENT_WORKSPACE_RUNTIME_POLICY.imageCount;
    const chunk = Math.floor(limit / (count - 1) / 4) * 4 - 4;
    const remaining = limit - chunk * (count - 1); // 留出一个槽位与少量字节，验证拒绝后两者都能复用。
    const image_path = "work/image.webp";
    const refused_path = "work/refused.webp";
    fixture.prepare_image.mockImplementation(async (bytes) => ({
      data: "A".repeat(Buffer.from(bytes).toString() === "refused" ? remaining + 4 : chunk),
      mimeType: "image/webp",
      width: 1,
      height: 1,
      originalWidth: 1,
      originalHeight: 1,
    }));
    fixture.run.mockImplementationOnce(async (request, signal) => {
      fs.writeFileSync(path.join(request.workspacePath, image_path), "image");
      fs.writeFileSync(path.join(request.workspacePath, refused_path), "refused");
      for (let i = 0; i < count - 1; i++) await request.emitImage!(image_path, signal);
      // 重复拒绝覆盖占位泄漏，成功补足额度同时证明失败没有增加累计大小。
      for (let i = 0; i < count; i++)
        await expect(request.emitImage!(refused_path, signal)).rejects.toThrow(refused_path);
      const prepared = await fixture.prepare_image(Buffer.from("image"));
      fixture.prepare_image.mockResolvedValueOnce({ ...prepared, data: "A".repeat(remaining) });
      await request.emitImage!(image_path, signal);
      return { execution: workspace_execution(), todos: [] };
    });
    const result = await run_workspace(fixture);
    expect(result.images).toHaveLength(count);
    expect(result.images.every((image) => image.path === image_path)).toBe(true);
    expect(result.images.reduce((total, { image }) => total + image.data.length, 0)).toBe(limit);
    fixture.run.mockImplementationOnce(async (request, signal) => {
      await request.emitImage!(refused_path, signal);
      return { execution: workspace_execution(), todos: [] };
    });
    expect((await run_workspace(fixture)).images.map((image) => image.path)).toEqual([
      refused_path,
    ]);
  });

  it("失败输出只携带图片摘要，恢复时可读取保留的文件", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
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
      await fixture.service.reset_workspace();
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
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
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
        if (action === "reset") await fixture.service.reset_workspace();
        else await fixture.service.reset_project(null);
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
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    fixture.run.mockImplementationOnce(async () => {
      fs.writeFileSync(path.join(fixture.workspace_root, "work", "ready.md"), "ready");
      fixture.pick_save_path.mockResolvedValueOnce(path.join(temp_dir, "saved.md"));
      await expect(fixture.service.activate_path("work/ready.md")).rejects.toMatchObject({
        code: "runtime.busy",
      });
      await expect(fixture.service.activate_path("work/")).resolves.toEqual({ status: "opened" });
      return { execution: workspace_execution(), todos: [] };
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
    const fixture = create_fixture(temp_dir);
    fs.mkdirSync(path.join(fixture.workspace_root, "stale"), { recursive: true });
    fs.writeFileSync(path.join(fixture.workspace_root, "stale", "partial.json"), "{}");
    await fixture.service.initialize();
    expect(fs.existsSync(path.join(fixture.workspace_root, "stale"))).toBe(false);

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
          source_text_path: "sources/script.txt",
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
        warnings: ["GLOSSARY"],
        warning_fragments_by_code: {},
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

  it("重新初始化解除旧依赖链接并清理工作材料，部署目录保持完整", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    const modules = path.join(fixture.workspace_root, "node_modules");
    const deployed = fs.realpathSync(modules);
    const marker = path.join(deployed, "installed.txt");
    fs.writeFileSync(marker, "installed");
    await run_workspace(fixture);
    await fixture.service.initialize();
    expect(fs.realpathSync(modules)).toBe(deployed);
    expect(fs.readFileSync(marker, "utf8")).toBe("installed");
    expect(fs.existsSync(path.join(fixture.workspace_root, "work"))).toBe(false);
    expect(fs.readFileSync(path.join(fixture.workspace_root, "package.json"), "utf8")).toBe(
      fs.readFileSync(path.join(temp_dir, "runtime", "package.json"), "utf8"),
    );
  });

  it("sources 只在工程或 files revision 变化时重新生成", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();

    await fixture.service.reset_project("test.lg");
    expect(
      fs.readFileSync(path.join(fixture.workspace_root, "sources", "script.txt"), "utf-8"),
    ).toBe("源文件正文");
    expect(fixture.read_asset_content).toHaveBeenCalledOnce();

    await run_workspace(fixture);
    await fixture.service.reset_workspace();
    expect(fs.existsSync(path.join(fixture.workspace_root, "sources", "script.txt"))).toBe(true);
    await run_workspace(fixture);
    expect(fixture.read_asset_content).toHaveBeenCalledOnce();

    await fixture.service.reset_project("test.lg");
    expect(fixture.read_asset_content).toHaveBeenCalledTimes(2);
    await run_workspace(fixture);
    expect(fixture.read_asset_content).toHaveBeenCalledTimes(2);

    fixture.snapshot.sectionRevisions.files = 2;
    await run_workspace(fixture);
    expect(fixture.read_asset_content).toHaveBeenCalledTimes(3);

    await fixture.service.reset_project(null);
    expect(fs.existsSync(path.join(fixture.workspace_root, "sources"))).toBe(false);
    expect(fs.existsSync(path.join(fixture.workspace_root, AGENT_WORKSPACE_WORK_ROOT))).toBe(false);
  });

  it("目录 rename 不可用时仍能在工程加载阶段生成 sources", async () => {
    const native_fs = new NativeFs();
    vi.spyOn(native_fs, "rename").mockImplementation(() => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    });
    const fixture = create_fixture(temp_dir, native_fs);
    await fixture.service.initialize();

    await expect(fixture.service.reset_project("test.lg")).resolves.toBeUndefined();
    expect(
      fs.readFileSync(path.join(fixture.workspace_root, "sources", "script.txt"), "utf-8"),
    ).toBe("源文件正文");
  });

  it("work 跨快照、apply 与普通 revision 变化保留，显式 reset 时清理", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
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
    await fixture.service.run(VALID_WORKSPACE_SCRIPT, [], new AbortController().signal);
    expect(fs.readFileSync(work_file, "utf-8")).toBe('{"step":1}\n');

    await fixture.service.reset_workspace();
    expect(fs.existsSync(path.join(fixture.workspace_root, AGENT_WORKSPACE_WORK_ROOT))).toBe(false);
  });

  it("sources 生成失败不阻断工程加载，并由 workspace_run 触发重试", async () => {
    const fixture = create_fixture(temp_dir);
    fixture.read_asset_content.mockImplementation(() => {
      throw new Error("asset read failed");
    });
    await fixture.service.initialize();

    await expect(fixture.service.reset_project("test.lg")).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(fixture.workspace_root, "sources"))).toBe(false);

    fixture.read_asset_content.mockReturnValue(Buffer.from("源文件正文", "utf-8"));
    await run_workspace(fixture);
    expect(fs.existsSync(path.join(fixture.workspace_root, "sources", "script.txt"))).toBe(true);
  });

  it("stale 快照的数据读取失败时保留此前完整快照与兼容 work", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await run_workspace(fixture);
    const previous_path = fixture.active_path();
    const work_file = path.join(fixture.workspace_root, AGENT_WORKSPACE_WORK_ROOT, "state.json");
    fs.writeFileSync(work_file, "state");
    fixture.snapshot.sectionRevisions.items = 2;
    fixture.query_warnings.mockRejectedValueOnce(new Error("warning query failed"));

    await expect(run_workspace(fixture)).rejects.toThrow("warning query failed");
    expect(fixture.active_path()).toBe(previous_path);
    expect(fs.readFileSync(work_file, "utf-8")).toBe("state");
    await fixture.service.run(VALID_WORKSPACE_SCRIPT, [], new AbortController().signal);
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
      if (normalized_path.endsWith(AGENT_WORKSPACE_CONTRACT.datasets.items.reference)) {
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
    const fixture = create_fixture(temp_dir, native_fs);
    await fixture.service.initialize();

    const environment_files = fs.readdirSync(fixture.workspace_root);
    const script = run_workspace(fixture);
    await delayed_write_started;
    await new Promise<void>((resolve) => setImmediate(resolve));
    release_delayed_write();

    await expect(script).rejects.toThrow("contract write failed");
    expect(cleanup_started_while_write_pending).toBe(false);
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([...environment_files, "sources"]);
  });

  it("脚本错误和 runtime 故障都保留已经写入的工作文件", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await run_workspace(fixture);
    const active_path = fixture.active_path();
    const work_file = path.join(fixture.workspace_root, AGENT_WORKSPACE_WORK_ROOT, "state.json");
    fs.writeFileSync(work_file, "state");
    fixture.run.mockRejectedValueOnce(
      new AgentWorkspaceRunError("脚本失败", {
        ...workspace_execution({ completed: 1 }, { message: "脚本失败" }),
        exitCode: 1,
      }),
    );

    await expect(
      fixture.service.run("throw new Error();", ["恢复任务"], new AbortController().signal),
    ).rejects.toMatchObject({
      public_details: {
        action: "workspace_run",
        stdout: { content: { completed: 1 } },
        stderr: { content: { message: "脚本失败" } },
      },
    });
    const { scriptPath } = fixture.run.mock.lastCall![0];
    expect(path.posix.dirname(scriptPath)).toBe(AGENT_WORKSPACE_RUN_ROOT);
    expect(path.posix.extname(scriptPath)).toBe(".mjs");
    const run_path = scriptPath.slice(0, -".mjs".length);
    expect(fixture.run).toHaveBeenLastCalledWith(
      {
        workspacePath: active_path,
        scriptPath,
        stdoutPath: `${run_path}.stdout.log`,
        stderrPath: `${run_path}.stderr.log`,
        todos: ["恢复任务"],
        host: expect.any(Function),
        emitImage: expect.any(Function),
      },
      expect.any(AbortSignal),
    );
    expect(fixture.active_path()).not.toBe("");
    expect(fs.readFileSync(work_file, "utf-8")).toBe("state");

    fixture.run.mockRejectedValueOnce(new Error("host disconnected"));
    await expect(
      fixture.service.run(VALID_WORKSPACE_SCRIPT, [], new AbortController().signal),
    ).rejects.toMatchObject({ public_details: { action: "workspace_run" } });
    expect(fixture.active_path()).not.toBe("");
    expect(fs.readFileSync(work_file, "utf-8")).toBe("state");
  });

  it("apply 只提交显式 change，成功后销毁快照并保留 work", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
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
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
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
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
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
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
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
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
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
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
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
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
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
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
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
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
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
    const fixture = create_fixture(temp_dir);
    const query_warnings = fixture.query_warnings.getMockImplementation();
    if (query_warnings === undefined) throw new Error("缺少校对查询 fixture");
    fixture.query_warnings.mockImplementationOnce(async () => {
      const result = await query_warnings();
      fixture.snapshot.sectionRevisions.items = 2;
      return result;
    });
    await fixture.service.initialize();
    const environment_files = fs.readdirSync(fixture.workspace_root);

    await expect(run_workspace(fixture)).rejects.toMatchObject({
      public_details: { action: "workspace_run" },
    });
    expect(fs.readdirSync(fixture.workspace_root)).toEqual(environment_files);
  });

  it.each(PROJECT_DATA_SECTIONS)("%s revision 变化会替换旧快照", async (section) => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await run_workspace(fixture);
    const change_file = path.join(
      fixture.active_path(),
      AGENT_WORKSPACE_CHANGE_PATHS.items.updates,
    );
    fs.writeFileSync(change_file, "pending");
    fixture.snapshot.sectionRevisions[section] = 2;

    await fixture.service.run(VALID_WORKSPACE_SCRIPT, [], new AbortController().signal);
    expect(fs.readFileSync(change_file, "utf-8")).toBe("");
  });

  it.each(["epoch", "language"] as const)("%s 变化先清除旧 work，再读取快照", async (field) => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await run_workspace(fixture);
    const work_file = path.join(fixture.workspace_root, AGENT_WORKSPACE_WORK_ROOT, "state.json");
    fs.writeFileSync(work_file, "state");
    if (field === "epoch") fixture.snapshot.epoch += 1;
    else fixture.setting.target_language = "EN";
    fixture.query_warnings.mockRejectedValueOnce(new Error("warning query failed"));

    await expect(run_workspace(fixture)).rejects.toThrow("warning query failed");
    expect(fs.existsSync(work_file)).toBe(false);

    await fixture.service.run(VALID_WORKSPACE_SCRIPT, [], new AbortController().signal);
    expect(fs.existsSync(work_file)).toBe(false);
  });
});

/** 通过公开脚本入口按需建立或刷新工作区。 */
async function run_workspace(
  fixture: ReturnType<typeof create_fixture>,
): ReturnType<AgentWorkspaceService["run"]> {
  return await fixture.service.run(VALID_WORKSPACE_SCRIPT, [], new AbortController().signal);
}

/** 用真实磁盘工作区替换宿主脚本端口，其余协作者保持最小可观察 fake。 */
function create_fixture(temp_dir: string, native_fs?: NativeFs) {
  const workspace_root = path.join(temp_dir, "workspaces");
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
  const quality = Object.fromEntries(
    QUALITY_RULE_KINDS.map((kind) => [kind, { entries: [create_quality_entry(kind)] }]),
  ) as JsonRecord;
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
        translation: { enabled: true, text: "翻译正文" },
      }),
    },

    readSectionRevisions: () => ({ ...snapshot.sectionRevisions }),
    snapshot: () => ({ ...snapshot, sectionRevisions: { ...snapshot.sectionRevisions } }),
  };
  const run = vi.fn<AgentWorkspaceRunPort>(async (request) => ({
    execution: workspace_execution(),
    todos: [...request.todos],
  }));
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
          warnings: ["GLOSSARY" as const],
          warning_fragments_by_code: {},
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
      get_agent_workspace_root_dir: () => workspace_root,
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
    },
    runtimeGate: { run_agent_project_write: runtime_gate },
    writeStore: { apply_agent_workspace_changes: write_store },
    logManager: { warning: vi.fn() },
    run,
    openDirectory: open_directory,
    pickSavePath: pick_save_path,
    ...(native_fs === undefined ? {} : { nativeFs: native_fs }),
  });
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
  const fixture = create_fixture(temp_dir);
  await fixture.service.initialize();
  const file = path.join(fixture.workspace_root, "work", "结果 # %23.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "报告");
  const destination = path.join(temp_dir, "saved.md");
  fixture.pick_save_path.mockResolvedValue(destination);
  return { ...fixture, file, destination, href: "work/结果%20%23%20%2523.md" };
}
