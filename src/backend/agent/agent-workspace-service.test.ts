import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectItemPublicRecord } from "../../domain/item";
import { DEFAULT_SETTING } from "../../domain/setting";
import type { JsonRecord } from "../../domain/json";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";
import * as AppErrors from "../../shared/error";
import {
  PROJECT_DATA_SECTIONS,
  type ProjectDataSectionRevisions,
} from "../../shared/project-event";
import { NativeFs } from "../../native/native-fs";
import type { CacheReadPort } from "../cache/cache-types";
import type { QualityRuleAnalysisCacheResult } from "../cache/quality-rule-analysis-cache";
import type { ProjectWriteStore } from "../project/project-write-store";
import { AgentWorkspaceService, type AgentWorkspaceRunPort } from "./agent-workspace-service";
import {
  AGENT_WORKSPACE_CHANGE_PATHS,
  AGENT_WORKSPACE_CONTRACT,
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS,
  AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
  AGENT_WORKSPACE_QUALITY_ENTRY_PATHS,
  AGENT_WORKSPACE_QUALITY_EVIDENCE_PATHS,
  AGENT_WORKSPACE_RECIPE_PATHS,
} from "./agent-workspace-contract";

describe("AgentWorkspaceService", () => {
  let temp_dir = "";

  beforeEach(() => {
    temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-workspace-"));
  });

  afterEach(() => {
    fs.rmSync(temp_dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("load 生成只读快照、空 change 文件并只返回摘要", async () => {
    const fixture = create_fixture(temp_dir);
    fs.mkdirSync(path.join(fixture.workspace_root, "stale"), { recursive: true });
    fs.writeFileSync(path.join(fixture.workspace_root, "stale", "partial.json"), "{}");
    await fixture.service.initialize();
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);

    await expect(fixture.service.load_workspace()).resolves.toEqual({
      status: "loaded",
      source_language: DEFAULT_SETTING.source_language,
      target_language: DEFAULT_SETTING.target_language,
      counts: {
        files: 1,
        items: 2,
        items_with_warnings: 1,
        glossary: 1,
        text_preserve: 1,
        pre_replacement: 1,
        post_replacement: 1,
      },
    });

    const active_path = fixture.active_path();
    expect(read_json(path.join(active_path, "contract.json"))).toEqual(AGENT_WORKSPACE_CONTRACT);
    expect(read_jsonl(path.join(active_path, AGENT_WORKSPACE_PATHS.items))).toHaveLength(2);
    expect(read_jsonl(path.join(active_path, AGENT_WORKSPACE_PATHS.warnings))).toEqual([
      {
        item_id: 1,
        warnings: ["GLOSSARY"],
        warning_fragments_by_code: {},
        glossary_applications: [],
      },
    ]);
    expect(read_json(path.join(active_path, AGENT_WORKSPACE_PATHS.prompts))).toEqual({
      translation: "翻译正文",
      analysis: "分析正文",
    });
    for (const kind of QUALITY_RULE_KINDS) {
      expect(
        read_jsonl(path.join(active_path, AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind])),
      ).toHaveLength(1);
      expect(
        read_json(path.join(active_path, AGENT_WORKSPACE_QUALITY_EVIDENCE_PATHS[kind])),
      ).toMatchObject({ groups: [[`${kind}-1`]] });
    }
    for (const relative_path of all_change_paths()) {
      expect(fs.readFileSync(path.join(active_path, relative_path), "utf-8")).toBe("");
    }
    expect(list_files(active_path).sort()).toEqual(
      [
        ...Object.values(AGENT_WORKSPACE_PATHS),
        ...Object.values(AGENT_WORKSPACE_QUALITY_ENTRY_PATHS),
        ...Object.values(AGENT_WORKSPACE_QUALITY_EVIDENCE_PATHS),
        ...Object.values(AGENT_WORKSPACE_RECIPE_PATHS),
        ...all_change_paths(),
      ].sort(),
    );
    expect(await fixture.service.load_workspace()).toMatchObject({ status: "loaded" });
    expect(fs.readdirSync(fixture.workspace_root)).toHaveLength(1);
  });

  it("新 load 失败时继续保留此前成功工作区", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await fixture.service.load_workspace();
    const previous_path = fixture.active_path();
    fixture.quality_analysis.mockRejectedValueOnce(new Error("analysis failed"));

    await expect(fixture.service.load_workspace()).rejects.toThrow("analysis failed");
    expect(fixture.active_path()).toBe(previous_path);
    await expect(
      fixture.service.run_script("return null", new AbortController().signal),
    ).resolves.toBeNull();
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
      if (normalized_path.endsWith(AGENT_WORKSPACE_CHANGE_PATHS.items.updates)) {
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

    const load = fixture.service.load_workspace();
    await delayed_write_started;
    await new Promise<void>((resolve) => setImmediate(resolve));
    release_delayed_write();

    await expect(load).rejects.toThrow("contract write failed");
    expect(cleanup_started_while_write_pending).toBe(false);
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });

  it("脚本失败保留工作区，宿主未知失败或明确失效才销毁", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await fixture.service.load_workspace();
    const active_path = fixture.active_path();
    fixture.run.mockResolvedValueOnce({
      status: "failed",
      failure: "execution_failed",
      message: "脚本失败",
      workspaceState: "preserved",
    });

    await expect(
      fixture.service.run_script("throw new Error()", new AbortController().signal),
    ).rejects.toMatchObject({ public_details: { action: "workspace_script" } });
    expect(fixture.run).toHaveBeenCalledWith(
      { workspacePath: active_path, script: "throw new Error()" },
      expect.any(AbortSignal),
    );
    expect(fixture.active_path()).not.toBe("");

    fixture.run.mockRejectedValueOnce(new Error("host disconnected"));
    await expect(
      fixture.service.run_script("return null", new AbortController().signal),
    ).rejects.toMatchObject({ public_details: { action: "workspace_load" } });
    expect(fixture.active_path()).toBe("");

    await fixture.service.load_workspace();
    fixture.run.mockResolvedValueOnce({
      status: "failed",
      failure: "workspace_invalid",
      message: "工作区失效",
      workspaceState: "invalidated",
    });
    await expect(
      fixture.service.run_script("return null", new AbortController().signal),
    ).rejects.toMatchObject({ public_details: { action: "workspace_load" } });
    expect(fixture.active_path()).toBe("");
  });

  it("apply 只提交显式 change，并在成功后销毁工作区", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await fixture.service.load_workspace();
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 2, dst: "译文-2" },
    ]);
    write_rows(fixture.active_path(), AGENT_WORKSPACE_QUALITY_CHANGE_PATHS.glossary.updates, [
      { id: "glossary-1", dst: "姬" },
    ]);
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.prompts.updates, [
      { kind: "translation", text: "新翻译正文" },
    ]);

    await expect(fixture.service.apply_workspace()).resolves.toEqual({
      status: "applied",
      changes: {
        items: { updated: 1 },
        quality: { glossary: { created: 0, updated: 1, deleted: 0, moved: 0 } },
        prompts: { updated: ["translation"] },
      },
      revisions: { items: 2, proofreading: 2, quality: 2, prompts: 2 },
    });
    expect(fixture.write_store).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: "test.lg",
        expectedSectionRevisions: fixture.revisions,
        itemChanges: [
          expect.objectContaining({
            item_id: 2,
            next: expect.objectContaining({ dst: "译文-2" }),
          }),
        ],
        qualityChanges: [expect.objectContaining({ kind: "glossary" })],
        promptChanges: [{ kind: "translation", text: "新翻译正文" }],
      }),
    );
    expect(fixture.active_path()).toBe("");
  });

  it("change 校验失败保留工作区供脚本修复", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await fixture.service.load_workspace();
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, dst: "甲" },
      { item_id: 1, dst: "乙" },
    ]);

    await expect(fixture.service.apply_workspace()).rejects.toMatchObject({
      public_details: { action: "workspace_script" },
    });
    expect(fixture.active_path()).not.toBe("");

    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, dst: "甲" },
    ]);
    await expect(fixture.service.apply_workspace()).resolves.toMatchObject({ status: "applied" });
  });

  it("数据库回滚失败保留工作区并允许安全重试", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await fixture.service.load_workspace();
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, dst: "译文" },
    ]);
    fixture.write_store.mockRejectedValueOnce(new Error("database failed"));

    await expect(fixture.service.apply_workspace()).rejects.toMatchObject({
      public_details: { action: "workspace_apply" },
    });
    expect(fixture.active_path()).not.toBe("");
    await expect(fixture.service.apply_workspace()).resolves.toMatchObject({ status: "applied" });
  });

  it("revision 冲突销毁工作区并要求重新 load", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await fixture.service.load_workspace();
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, dst: "译文" },
    ]);
    fixture.write_store.mockRejectedValueOnce(new AppErrors.AppError("data.revision_conflict"));

    await expect(fixture.service.apply_workspace()).rejects.toMatchObject({
      public_details: { action: "workspace_load" },
    });
    expect(fixture.active_path()).toBe("");
  });

  it("提交后同步失败明确保留 committed 事实并销毁工作区", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await fixture.service.load_workspace();
    write_rows(fixture.active_path(), AGENT_WORKSPACE_CHANGE_PATHS.items.updates, [
      { item_id: 1, dst: "译文" },
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
  });

  it("无真实 change 不触达项目写入口并销毁工作区", async () => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await fixture.service.load_workspace();

    await expect(fixture.service.apply_workspace()).resolves.toEqual({
      status: "unchanged",
      changes: {},
      revisions: { items: 1, proofreading: 1, quality: 1, prompts: 1 },
    });
    expect(fixture.write_store).not.toHaveBeenCalled();
    expect(fixture.active_path()).toBe("");
  });

  it("load 派生数据读取期间 revision 漂移时拒绝生成混合快照", async () => {
    const fixture = create_fixture(temp_dir);
    const read_quality_analysis = fixture.quality_analysis.getMockImplementation();
    if (read_quality_analysis === undefined) throw new Error("缺少质量分析 fixture");
    fixture.quality_analysis.mockImplementationOnce(async (kind) => {
      const result = await read_quality_analysis(kind);
      fixture.snapshot.sectionRevisions.items = 2;
      return result;
    });
    await fixture.service.initialize();

    await expect(fixture.service.load_workspace()).rejects.toMatchObject({
      public_details: { action: "workspace_load" },
    });
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });

  it.each(PROJECT_DATA_SECTIONS)("%s revision 变化会销毁旧工作区", async (section) => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await fixture.service.load_workspace();
    fixture.snapshot.sectionRevisions[section] = 2;

    await expect(
      fixture.service.run_script("return null", new AbortController().signal),
    ).rejects.toMatchObject({ public_details: { action: "workspace_load" } });
    expect(fixture.active_path()).toBe("");
  });

  it.each(["epoch", "language"] as const)("%s 变化会销毁旧工作区", async (field) => {
    const fixture = create_fixture(temp_dir);
    await fixture.service.initialize();
    await fixture.service.load_workspace();
    if (field === "epoch") fixture.snapshot.epoch += 1;
    else fixture.setting.target_language = "EN";

    await expect(
      fixture.service.run_script("return null", new AbortController().signal),
    ).rejects.toMatchObject({ public_details: { action: "workspace_load" } });
    expect(fixture.active_path()).toBe("");
  });
});

/** 用真实磁盘工作区替换宿主脚本端口，其余协作者保持最小可观察 fake。 */
function create_fixture(temp_dir: string, native_fs?: NativeFs) {
  const workspace_root = path.join(temp_dir, "workspaces");
  const revisions = Object.fromEntries(
    ["project", "files", "items", "quality", "prompts", "analysis", "proofreading"].map(
      (section) => [section, 1],
    ),
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
        analysis: { enabled: true, text: "分析正文" },
      }),
    },
    analysis: { readBlock: () => ({}) },
    readSectionRevisions: () => ({ ...snapshot.sectionRevisions }),
    snapshot: () => ({ ...snapshot, sectionRevisions: { ...snapshot.sectionRevisions } }),
  };
  const quality_analysis = vi.fn(
    async (kind: QualityRuleKind): Promise<QualityRuleAnalysisCacheResult> => {
      const entries = (quality[kind] as { entries: JsonRecord[] }).entries;
      const entry_ids = entries.map((entry) => String(entry["entry_id"]));
      return {
        projectPath: snapshot.projectPath,
        sectionRevisions: { ...snapshot.sectionRevisions },
        analysis: {
          entry_ids,
          hits_by_entry_id: Object.fromEntries(entry_ids.map((id) => [id, 1])),
          examples_by_entry_id: Object.fromEntries(entry_ids.map((id) => [id, ["原文"]])),
          relations: {
            subset_parents_by_entry_id: {},
            groups: entry_ids.map((id) => [id]),
          },
        },
      };
    },
  );
  const run = vi.fn<AgentWorkspaceRunPort>(async () => ({ status: "success", result: null }));
  const write_store = vi.fn<ProjectWriteStore["apply_agent_workspace_changes"]>(
    async (request) => ({
      committed: true,
      sectionRevisions: {
        ...revisions,
        ...(request.itemChanges.length === 0 ? {} : { items: 2, proofreading: 2 }),
        ...(request.qualityChanges.length === 0 ? {} : { quality: 2 }),
        ...(request.promptChanges.length === 0 ? {} : { prompts: 2 }),
      },
    }),
  );
  const runtime_gate = vi.fn(async (operation: () => ReturnType<typeof write_store>) =>
    operation(),
  );
  const warning_item = items[0] as JsonRecord;
  const setting = { ...DEFAULT_SETTING };
  const service = new AgentWorkspaceService({
    paths: {
      get_agent_workspace_root_dir: () => workspace_root,
      get_agent_workspace_recipe_dir: () => path.resolve("resource/agent/workspace/recipes"),
    },
    settings: { read_setting: () => ({ ...setting }) },
    sessionState: { require_loaded_project_path: () => snapshot.projectPath },
    cache,
    qualityAnalysis: { read: quality_analysis },
    proofreading: {
      query_warnings: async () => ({
        projectPath: snapshot.projectPath,
        sectionRevisions: { ...snapshot.sectionRevisions },
        data: {
          total_item_count: 1,
          items: [
            {
              item_id: 1,
              file_path: "script.txt",
              row_number: 0,
              src: String(warning_item["src"]),
              dst: "",
              name_src: null,
              name_dst: null,
              status: "NONE",
              retry_count: 0,
              row_id: "item:1",
              compressed_src: String(warning_item["src"]),
              compressed_dst: "",
              warnings: ["GLOSSARY"],
              warning_fragments_by_code: {},
              glossary_applications: [],
            },
          ],
        },
      }),
    },
    runtimeGate: { run_agent_project_write: runtime_gate },
    writeStore: { apply_agent_workspace_changes: write_store },
    logManager: { warning: vi.fn() },
    run,
    ...(native_fs === undefined ? {} : { nativeFs: native_fs }),
  });
  return {
    service,
    workspace_root,
    revisions,
    snapshot,
    setting,
    quality_analysis,
    run,
    write_store,
    active_path: () => {
      if (!fs.existsSync(workspace_root)) return "";
      const names = fs.readdirSync(workspace_root);
      return names.length === 1 ? path.join(workspace_root, names[0] as string) : "";
    },
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

/** 直接准备 apply 输入，脚本事务本身由宿主层测试负责。 */
function write_rows(workspace_path: string, relative_path: string, rows: JsonRecord[]): void {
  fs.writeFileSync(
    path.join(workspace_path, relative_path),
    rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf-8",
  );
}

/** 递归列出工作区实际文件，空目录不参与固定布局断言。 */
function list_files(root: string, relative = ""): string[] {
  const directory = path.join(root, relative);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.posix.join(relative.replace(/\\/g, "/"), entry.name);
    return entry.isDirectory() ? list_files(root, child) : [child];
  });
}

/** 测试初始化与生产 load 共享同一固定 change 路径集合。 */
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
