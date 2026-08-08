import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { read_json_record, type JsonRecord } from "../../domain/json";
import { DEFAULT_SETTING } from "../../domain/setting";
import { QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";
import {
  PROJECT_DATA_SECTIONS,
  type ProjectDataSectionRevisions,
  type ProjectWriteResult,
} from "../../shared/project-event";
import type { CacheReadPort, CacheSnapshot } from "../cache/cache-types";
import type { QualityRuleAnalysisCacheResult } from "../cache/quality-rule-analysis-cache";
import type { ProjectWriteStore } from "../project/project-write-store";
import { ensure_quality_rule_entry_ids } from "../../shared/quality/quality-rule-entry-id";
import {
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_ANALYSIS_PATHS,
  AGENT_WORKSPACE_QUALITY_PATHS,
} from "./agent-workspace-contract";
import { AgentWorkspaceService, type AgentWorkspaceRunPort } from "./agent-workspace-service";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-workspace-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("AgentWorkspaceService create", () => {
  it("无参数创建完整固定工作区并只投影语言", async () => {
    const fixture = create_fixture();
    await fixture.service.initialize();

    const manifest = await fixture.service.create_workspace();
    const workspace_path = fixture.active_path();

    expect(manifest).toEqual({
      project: { source_language: "JA", target_language: "ZH" },
      revisions: fixture.revisions,
      counts: {
        items: 1,
        files: 1,
        warnings: 1,
        analysis_candidates: 1,
        quality: { glossary: 1, text_preserve: 1, pre_replacement: 1, post_replacement: 1 },
        prompts: 2,
      },
      recipes: ["inspect-items", "inspect-quality"],
    });
    const expected_paths = [
      ...Object.values(AGENT_WORKSPACE_PATHS),
      ...Object.values(AGENT_WORKSPACE_QUALITY_PATHS),
      ...Object.values(AGENT_WORKSPACE_QUALITY_ANALYSIS_PATHS),
      "recipes/inspect-items.js",
      "recipes/inspect-quality.js",
    ];
    for (const relative_path of expected_paths) {
      expect(fs.existsSync(path.join(workspace_path, relative_path)), relative_path).toBe(true);
    }
    expect(list_files(workspace_path).sort()).toEqual([...expected_paths].sort());
    expect(read_jsonl(path.join(workspace_path, AGENT_WORKSPACE_PATHS.items))[0]).toMatchObject({
      name_src: "",
      name_dst: "",
    });
    expect(read_jsonl(path.join(workspace_path, AGENT_WORKSPACE_PATHS.warnings))[0]).toMatchObject({
      item_id: 1,
      name_src: "",
      name_dst: "",
      warnings: ["GLOSSARY"],
    });
    expect(read_json(path.join(workspace_path, AGENT_WORKSPACE_PATHS.prompts))).toEqual({
      translation: "翻译正文",
      analysis: "分析正文",
    });
    expect(
      fs.readFileSync(path.join(workspace_path, AGENT_WORKSPACE_PATHS.manifest), "utf-8"),
    ).not.toContain("enabled");
    for (const kind of QUALITY_RULE_KINDS) {
      expect(
        read_json(path.join(workspace_path, AGENT_WORKSPACE_QUALITY_ANALYSIS_PATHS[kind])),
      ).toMatchObject({ entry_ids: [`${kind}-1`] });
    }
  });

  it("空集合仍生成全部固定数据文件", async () => {
    const fixture = create_fixture({ items: [], empty: true });
    await fixture.service.initialize();

    const manifest = await fixture.service.create_workspace();
    const workspace_path = fixture.active_path();

    expect(manifest["counts"]).toEqual({
      items: 0,
      files: 1,
      warnings: 0,
      analysis_candidates: 0,
      quality: { glossary: 0, text_preserve: 0, pre_replacement: 0, post_replacement: 0 },
      prompts: 2,
    });
    expect(read_jsonl(path.join(workspace_path, AGENT_WORKSPACE_PATHS.items))).toEqual([]);
    expect(read_jsonl(path.join(workspace_path, AGENT_WORKSPACE_PATHS.warnings))).toEqual([]);
    expect(read_jsonl(path.join(workspace_path, AGENT_WORKSPACE_PATHS.analysisCandidates))).toEqual(
      [],
    );
    for (const kind of QUALITY_RULE_KINDS) {
      expect(read_jsonl(path.join(workspace_path, AGENT_WORKSPACE_QUALITY_PATHS[kind]))).toEqual(
        [],
      );
    }
  });

  it("没有持久化 ID 的既有质量规则使用共享稳定身份创建工作区", async () => {
    const fixture = create_fixture({ legacyQualityIds: true });
    await fixture.service.initialize();

    await fixture.service.create_workspace();

    expect(
      read_jsonl(path.join(fixture.active_path(), AGENT_WORKSPACE_QUALITY_PATHS.glossary))[0],
    ).toMatchObject({ id: "姫::0" });
  });

  it("initialize 清除崩溃遗留目录", async () => {
    const fixture = create_fixture();
    fs.mkdirSync(path.join(fixture.workspace_root, "stale"), { recursive: true });
    fs.writeFileSync(path.join(fixture.workspace_root, "stale", "partial.json"), "{}");

    await fixture.service.initialize();

    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });

  it("新 create 的依赖读取失败时保留旧 active", async () => {
    const fixture = create_fixture();
    await fixture.service.initialize();
    await fixture.service.create_workspace();
    const first_path = fixture.active_path();
    fixture.quality_analysis.mockRejectedValueOnce(new Error("analysis failed"));

    await expect(fixture.service.create_workspace()).rejects.toThrow("analysis failed");
    expect(fixture.active_path()).toBe(first_path);
    await expect(
      fixture.service.run_script("return null", new AbortController().signal),
    ).resolves.toBeNull();
  });

  it("create 派生数据读取期间 revision 漂移时不生成混合快照", async () => {
    const fixture = create_fixture();
    const read_quality_analysis = fixture.quality_analysis.getMockImplementation();
    if (read_quality_analysis === undefined) throw new Error("缺少质量分析 fixture");
    fixture.quality_analysis.mockImplementationOnce(async (kind) => {
      const result = await read_quality_analysis(kind);
      fixture.snapshot.sectionRevisions.items = 2;
      return result;
    });
    await fixture.service.initialize();

    await expect(fixture.service.create_workspace()).rejects.toThrow("request.validation_failed");
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });

  it.each(PROJECT_DATA_SECTIONS)("%s revision 变化会废弃工作区", async (section) => {
    const fixture = create_fixture();
    await fixture.service.initialize();
    await fixture.service.create_workspace();
    fixture.snapshot.sectionRevisions[section] = 2;

    await expect(
      fixture.service.run_script("return null", new AbortController().signal),
    ).rejects.toThrow("request.validation_failed");
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });

  it("工程 epoch 或语言变化会废弃工作区", async () => {
    for (const mutate of [
      (fixture: ReturnType<typeof create_fixture>) => {
        fixture.snapshot.epoch += 1;
      },
      (fixture: ReturnType<typeof create_fixture>) => {
        fixture.setting.target_language = "EN";
      },
    ]) {
      const fixture = create_fixture();
      await fixture.service.initialize();
      await fixture.service.create_workspace();
      mutate(fixture);
      await expect(
        fixture.service.run_script("return null", new AbortController().signal),
      ).rejects.toThrow("request.validation_failed");
      expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
    }
  });

  it("脚本或 recipe 执行失败会废弃工作区", async () => {
    const fixture = create_fixture();
    await fixture.service.initialize();
    await fixture.service.create_workspace();
    fixture.run.mockRejectedValueOnce(new Error("recipe failed"));

    await expect(
      fixture.service.run_script("run recipe", new AbortController().signal),
    ).rejects.toMatchObject({
      code: "runtime.internal_invariant",
      public_details: { action: "workspace_create" },
    });
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });
});

describe("AgentWorkspaceService apply", () => {
  it("自动检测混合 items、quality 与 prompts 差异并只调用一次 store", async () => {
    const fixture = create_fixture();
    fixture.run.mockImplementationOnce(async ({ workspacePath }) => {
      const item_path = path.join(workspacePath, AGENT_WORKSPACE_PATHS.items);
      const [item] = read_jsonl(item_path);
      write_jsonl(item_path, [{ ...item, dst: "新译文", name_dst: "新姓名", status: "EXCLUDED" }]);
      const glossary_path = path.join(workspacePath, AGENT_WORKSPACE_QUALITY_PATHS.glossary);
      const [glossary] = read_jsonl(glossary_path);
      write_jsonl(glossary_path, [
        { ...glossary, dst: "姬" },
        { src: "王都", dst: "王都", info: "地名", case_sensitive: false },
      ]);
      const replacement_path = path.join(
        workspacePath,
        AGENT_WORKSPACE_QUALITY_PATHS.pre_replacement,
      );
      const [replacement] = read_jsonl(replacement_path);
      write_jsonl(replacement_path, [{ ...replacement, dst: "王子" }]);
      const prompts_path = path.join(workspacePath, AGENT_WORKSPACE_PATHS.prompts);
      write_json(prompts_path, { translation: "新翻译正文", analysis: "新分析正文" });
      return { result: { changed: 6 } };
    });
    await fixture.service.initialize();
    await fixture.service.create_workspace();
    await fixture.service.run_script("return null", new AbortController().signal);

    const result = await fixture.service.apply_workspace();

    expect(fixture.write_store).toHaveBeenCalledOnce();
    const request = fixture.write_store.mock.calls[0]?.[0];
    expect(request?.itemChanges).toHaveLength(1);
    expect(request?.itemChanges[0]?.next).toMatchObject({
      dst: "新译文",
      status: "EXCLUDED",
      name_dst: "新姓名",
    });
    expect(request?.qualityChanges.map((change) => change.kind)).toEqual([
      "glossary",
      "pre_replacement",
    ]);
    expect(request?.promptChanges).toEqual([
      { kind: "translation", text: "新翻译正文" },
      { kind: "analysis", text: "新分析正文" },
    ]);
    expect(result).toMatchObject({
      status: "applied",
      changes: {
        items: { updated: 1 },
        quality: {
          glossary: { created: 1, updated: 1, deleted: 0, moved: 0 },
          pre_replacement: { created: 0, updated: 1, deleted: 0, moved: 0 },
        },
        prompts: { updated: ["translation", "analysis"] },
      },
    });
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });

  it("未改动时不进入写租约、不推进 revision 并销毁工作区", async () => {
    const fixture = create_fixture();
    await fixture.service.initialize();
    await fixture.service.create_workspace();

    await expect(fixture.service.apply_workspace()).resolves.toEqual({
      status: "unchanged",
      changes: {},
      revisions: { items: 1, proofreading: 1, quality: 1, prompts: 1 },
    });
    expect(fixture.runtime_gate).not.toHaveBeenCalled();
    expect(fixture.write_store).not.toHaveBeenCalled();
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });

  it("editable 校验失败保留工作区，后续脚本可修复后 apply", async () => {
    const fixture = create_fixture();
    fixture.run
      .mockImplementationOnce(async ({ workspacePath }) => {
        const item_path = path.join(workspacePath, AGENT_WORKSPACE_PATHS.items);
        const [item] = read_jsonl(item_path);
        write_jsonl(item_path, [{ ...item, src: "伪造原文", dst: "译文" }]);
        return { result: null };
      })
      .mockImplementationOnce(async ({ workspacePath }) => {
        const item_path = path.join(workspacePath, AGENT_WORKSPACE_PATHS.items);
        const [item] = read_jsonl(item_path);
        write_jsonl(item_path, [{ ...item, src: "原文-1", dst: "译文" }]);
        return { result: null };
      });
    await fixture.service.initialize();
    await fixture.service.create_workspace();
    await fixture.service.run_script("damage", new AbortController().signal);

    await expect(fixture.service.apply_workspace()).rejects.toThrow("request.validation_failed");
    expect(fixture.active_path()).toBeTruthy();
    await fixture.service.run_script("repair", new AbortController().signal);
    await expect(fixture.service.apply_workspace()).resolves.toMatchObject({ status: "applied" });
  });

  it("四类 quality 可在同一 apply 中修改、删除、新增和排序", async () => {
    const fixture = create_fixture();
    fixture.quality["post_replacement"] = {
      entries: [
        create_quality_entry("post_replacement"),
        {
          entry_id: "post_replacement-2",
          src: "殿下",
          dst: "王子",
          regex: false,
          case_sensitive: false,
        },
      ],
      enabled: true,
    };
    fixture.run.mockImplementationOnce(async ({ workspacePath }) => {
      const glossary_path = path.join(workspacePath, AGENT_WORKSPACE_QUALITY_PATHS.glossary);
      const [glossary] = read_jsonl(glossary_path);
      write_jsonl(glossary_path, [{ ...glossary, dst: "姬" }]);
      write_jsonl(path.join(workspacePath, AGENT_WORKSPACE_QUALITY_PATHS.text_preserve), []);
      const pre_path = path.join(workspacePath, AGENT_WORKSPACE_QUALITY_PATHS.pre_replacement);
      write_jsonl(pre_path, [
        ...read_jsonl(pre_path),
        { src: "王", dst: "国王", regex: false, case_sensitive: false },
      ]);
      const post_path = path.join(workspacePath, AGENT_WORKSPACE_QUALITY_PATHS.post_replacement);
      write_jsonl(post_path, read_jsonl(post_path).reverse());
      return { result: null };
    });
    await fixture.service.initialize();
    await fixture.service.create_workspace();
    await fixture.service.run_script("edit all quality", new AbortController().signal);
    await fixture.service.apply_workspace();

    expect(
      fixture.write_store.mock.calls[0]?.[0].qualityChanges.map((change) => change.kind),
    ).toEqual(QUALITY_RULE_KINDS);
  });

  it("拒绝未知 quality 字段、新增重复组和非法 prompt 形状", async () => {
    const scenarios: Array<(workspace_path: string) => void> = [
      (workspace_path) => {
        const file_path = path.join(workspace_path, AGENT_WORKSPACE_QUALITY_PATHS.glossary);
        const [row] = read_jsonl(file_path);
        write_jsonl(file_path, [{ ...row, enabled: true }]);
      },
      (workspace_path) => {
        const file_path = path.join(workspace_path, AGENT_WORKSPACE_QUALITY_PATHS.glossary);
        const [row] = read_jsonl(file_path);
        write_jsonl(file_path, [
          row,
          { src: row.src, dst: "另一译法", info: "", case_sensitive: false },
        ]);
      },
      (workspace_path) => {
        write_json(path.join(workspace_path, AGENT_WORKSPACE_PATHS.prompts), {
          translation: "正文",
          enabled: true,
        });
      },
    ];
    for (const mutate of scenarios) {
      const fixture = create_fixture();
      fixture.run.mockImplementationOnce(async ({ workspacePath }) => {
        mutate(workspacePath);
        return { result: null };
      });
      await fixture.service.initialize();
      await fixture.service.create_workspace();
      await fixture.service.run_script("edit", new AbortController().signal);
      await expect(fixture.service.apply_workspace()).rejects.toThrow("request.validation_failed");
      expect(fixture.write_store).not.toHaveBeenCalled();
      await fixture.service.reset();
    }
  });

  it("拒绝 item 集合身份破坏、未知字段和非人工状态", async () => {
    const scenarios: Array<(workspace_path: string) => void> = [
      (workspace_path) => write_jsonl(path.join(workspace_path, AGENT_WORKSPACE_PATHS.items), []),
      (workspace_path) => {
        const file_path = path.join(workspace_path, AGENT_WORKSPACE_PATHS.items);
        const [row] = read_jsonl(file_path);
        write_jsonl(file_path, [{ ...row, item_id: 99 }]);
      },
      (workspace_path) => {
        const file_path = path.join(workspace_path, AGENT_WORKSPACE_PATHS.items);
        const [row] = read_jsonl(file_path);
        write_jsonl(file_path, [{ ...row, extra: true }]);
      },
      (workspace_path) => {
        const file_path = path.join(workspace_path, AGENT_WORKSPACE_PATHS.items);
        const [row] = read_jsonl(file_path);
        write_jsonl(file_path, [{ ...row, status: "ERROR" }]);
      },
    ];
    for (const mutate of scenarios) {
      const fixture = create_fixture();
      fixture.run.mockImplementationOnce(async ({ workspacePath }) => {
        mutate(workspacePath);
        return { result: null };
      });
      await fixture.service.initialize();
      await fixture.service.create_workspace();
      await fixture.service.run_script("damage", new AbortController().signal);
      await expect(fixture.service.apply_workspace()).rejects.toThrow("request.validation_failed");
      expect(fixture.write_store).not.toHaveBeenCalled();
      await fixture.service.reset();
    }
  });

  it("拒绝伪造 quality ID、空 src、非法正则和错误 prompt 类型", async () => {
    const scenarios: Array<(workspace_path: string) => void> = [
      (workspace_path) => {
        const file_path = path.join(workspace_path, AGENT_WORKSPACE_QUALITY_PATHS.glossary);
        const [row] = read_jsonl(file_path);
        write_jsonl(file_path, [{ ...row, id: "forged" }]);
      },
      (workspace_path) => {
        const file_path = path.join(workspace_path, AGENT_WORKSPACE_QUALITY_PATHS.glossary);
        const [row] = read_jsonl(file_path);
        write_jsonl(file_path, [{ ...row, src: "" }]);
      },
      (workspace_path) => {
        const file_path = path.join(workspace_path, AGENT_WORKSPACE_QUALITY_PATHS.pre_replacement);
        const [row] = read_jsonl(file_path);
        write_jsonl(file_path, [{ ...row, src: "[", regex: true }]);
      },
      (workspace_path) => {
        write_json(path.join(workspace_path, AGENT_WORKSPACE_PATHS.prompts), {
          translation: 1,
          analysis: "正文",
        });
      },
    ];
    for (const mutate of scenarios) {
      const fixture = create_fixture();
      fixture.run.mockImplementationOnce(async ({ workspacePath }) => {
        mutate(workspacePath);
        return { result: null };
      });
      await fixture.service.initialize();
      await fixture.service.create_workspace();
      await fixture.service.run_script("damage", new AbortController().signal);
      await expect(fixture.service.apply_workspace()).rejects.toThrow("request.validation_failed");
      expect(fixture.write_store).not.toHaveBeenCalled();
      await fixture.service.reset();
    }
  });

  it("提交失败时销毁工作区并要求重新 create", async () => {
    const fixture = create_fixture();
    fixture.write_store.mockRejectedValueOnce(new Error("commit failed"));
    fixture.run.mockImplementationOnce(async ({ workspacePath }) => {
      const item_path = path.join(workspacePath, AGENT_WORKSPACE_PATHS.items);
      const [item] = read_jsonl(item_path);
      write_jsonl(item_path, [{ ...item, dst: "译文" }]);
      return { result: null };
    });
    await fixture.service.initialize();
    await fixture.service.create_workspace();
    await fixture.service.run_script("edit", new AbortController().signal);

    await expect(fixture.service.apply_workspace()).rejects.toMatchObject({
      code: "runtime.internal_invariant",
      public_details: { action: "workspace_create" },
    });
    expect(fs.readdirSync(fixture.workspace_root)).toEqual([]);
  });
});

/** 用真实磁盘工作区替换宿主脚本端口，cache 与事务边界保持最小可观察 fake。 */
function create_fixture(
  options: { items?: JsonRecord[]; empty?: boolean; legacyQualityIds?: boolean } = {},
) {
  const workspace_root = path.join(temp_dir, "workspace");
  const revisions: ProjectDataSectionRevisions = Object.fromEntries(
    PROJECT_DATA_SECTIONS.map((section) => [section, 1]),
  );
  const items = options.items ?? [create_item(1)];
  const snapshot: CacheSnapshot = {
    projectPath: path.join(temp_dir, "project.lg"),
    epoch: 1,
    freshness: "fresh",
    sectionRevisions: revisions,
    itemCount: items.length,
  };
  const quality = Object.fromEntries(
    QUALITY_RULE_KINDS.map((kind) => {
      const entry = create_quality_entry(kind);
      if (options.legacyQualityIds === true) delete entry["entry_id"];
      return [kind, { entries: options.empty === true ? [] : [entry], enabled: true }];
    }),
  ) as JsonRecord;
  const cache: CacheReadPort = {
    items: { readItems: () => items, readItem: () => null },
    files: { readFileEntries: () => [{ rel_path: "script.txt", file_type: "TXT", sort_index: 0 }] },
    quality: { readBlock: () => quality },
    prompts: {
      readBlock: () => ({
        translation: { enabled: true, text: "翻译正文", revision: 1 },
        analysis: { enabled: false, text: "分析正文", revision: 1 },
      }),
    },
    analysis: { readBlock: () => ({ extras: {}, candidate_count: 1, status_summary: {} }) },
    readSectionRevisions: () => revisions,
    snapshot: () => ({ ...snapshot, sectionRevisions: { ...snapshot.sectionRevisions } }),
  };
  const quality_analysis = vi.fn(
    async (kind: QualityRuleKind): Promise<QualityRuleAnalysisCacheResult> => {
      const entries = read_json_record(quality[kind])["entries"];
      const entry_ids = Array.isArray(entries)
        ? ensure_quality_rule_entry_ids(entries.map(read_json_record)).map(
            (entry) => entry.entry_id,
          )
        : [];
      return {
        projectPath: snapshot.projectPath,
        sectionRevisions: revisions,
        analysis: {
          entry_ids,
          hits_by_entry_id: Object.fromEntries(entry_ids.map((id) => [id, 1])),
          examples_by_entry_id: Object.fromEntries(entry_ids.map((id) => [id, ["原文-1"]])),
          relations: {
            subset_parents_by_entry_id: {},
            groups: entry_ids.map((id) => [id]),
          },
        },
      };
    },
  );
  const run = vi.fn<AgentWorkspaceRunPort>(async () => ({ result: null }));
  const runtime_gate = vi.fn(async (action: () => Promise<ProjectWriteResult>) => await action());
  const write_store = vi.fn<ProjectWriteStore["apply_agent_workspace_changes"]>(async () =>
    create_write_result({
      ...revisions,
      items: 2,
      proofreading: 2,
      quality: 2,
      prompts: 2,
    }),
  );
  const warning_item = items[0] ?? create_item(1);
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
        sectionRevisions: revisions,
        data: {
          total_item_count: options.empty === true ? 0 : 1,
          items:
            options.empty === true
              ? []
              : [
                  {
                    item_id: 1,
                    file_path: String(warning_item["file_path"] ?? "script.txt"),
                    row_number: Number(warning_item["row"] ?? 0),
                    src: String(warning_item["src"] ?? ""),
                    dst: String(warning_item["dst"] ?? ""),
                    name_src: null,
                    name_dst: null,
                    status: String(warning_item["status"] ?? "NONE"),
                    retry_count: Number(warning_item["retry_count"] ?? 0),
                    row_id: "item:1",
                    compressed_src: String(warning_item["src"] ?? ""),
                    compressed_dst: String(warning_item["dst"] ?? ""),
                    warnings: ["GLOSSARY"],
                    warning_fragments_by_code: {},
                    glossary_applications: [],
                  },
                ],
        },
      }),
    },
    readAnalysisCandidates: () => ({
      candidate_aggregate:
        options.empty === true
          ? ({} as JsonRecord)
          : {
              王都: {
                src: "王都",
                dst_votes: { 王都: 2 },
                info_votes: {},
                observation_count: 2,
                first_seen_at: 1,
                last_seen_at: 2,
                case_sensitive: false,
                first_seen_index: 0,
              },
            },
    }),
    runtimeGate: { run_agent_project_write: runtime_gate },
    writeStore: { apply_agent_workspace_changes: write_store },
    run,
  });
  return {
    service,
    workspace_root,
    revisions,
    snapshot,
    setting,
    quality,
    run,
    runtime_gate,
    write_store,
    quality_analysis,
    active_path: () => {
      const name = fs.readdirSync(workspace_root)[0];
      return name === undefined ? "" : path.join(workspace_root, name);
    },
  };
}

/** 构造工作区投影和写入差异共同需要的完整 item。 */
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

/** 四类 quality 复用身份骨架，各自只补真实领域字段。 */
function create_quality_entry(kind: QualityRuleKind): JsonRecord {
  const common = { entry_id: `${kind}-1`, src: kind === "glossary" ? "姫" : "公主" };
  if (kind === "glossary") return { ...common, dst: "公主", info: "称谓", case_sensitive: false };
  if (kind === "text_preserve") return { ...common, info: "保护" };
  return {
    ...common,
    dst: kind === "pre_replacement" ? "殿下" : "公主",
    regex: false,
    case_sensitive: false,
  };
}

function read_json(file_path: string): JsonRecord {
  return JSON.parse(fs.readFileSync(file_path, "utf-8")) as JsonRecord;
}

function write_json(file_path: string, value: JsonRecord): void {
  fs.writeFileSync(file_path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function read_jsonl(file_path: string): JsonRecord[] {
  return fs
    .readFileSync(file_path, "utf-8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as JsonRecord);
}

function write_jsonl(file_path: string, rows: JsonRecord[]): void {
  fs.writeFileSync(file_path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf-8");
}

/** 递归列出工作区实际文件，空目录不参与固定布局断言。 */
function list_files(root: string, relative = ""): string[] {
  const directory = path.join(root, relative);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.posix.join(relative.replace(/\\/g, "/"), entry.name);
    return entry.isDirectory() ? list_files(root, child) : [child];
  });
}

function create_write_result(section_revisions: ProjectDataSectionRevisions): ProjectWriteResult {
  return {
    accepted: true,
    changes: [
      {
        type: "project.changed",
        eventId: "workspace-test",
        source: "agent_workspace_apply",
        projectPath: "test.lg",
        projectRevision: Math.max(...Object.values(section_revisions), 0),
        sectionRevisions: section_revisions,
        updatedSections: ["items", "proofreading", "quality", "prompts"],
      },
    ],
  };
}
