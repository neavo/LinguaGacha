import { randomUUID } from "node:crypto";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  is_json_record,
  read_json_integer,
  read_json_record,
  type JsonRecord,
  type JsonValue,
  type MutableJsonRecord,
} from "../../domain/json";
import { Prompt, PROMPT_KINDS } from "../../domain/prompt";
import { QualityRule, QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";
import { normalize_setting_snapshot } from "../../domain/setting";
import type {
  BackendRuntimeAgentWorkspaceRunRequest,
  BackendRuntimeAgentWorkspaceRunResponse,
} from "../../shared/backend-runtime";
import * as AppErrors from "../../shared/error";
import {
  collect_quality_rule_duplicate_groups,
  QualityRuleImportRuleTypeValue,
  type QualityRuleImportRuleType,
} from "../../shared/quality/quality-rule-import";
import {
  create_quality_rule_entry_id,
  ensure_quality_rule_entry_ids,
} from "../../shared/quality/quality-rule-entry-id";
import { normalize_quality_rule_entries } from "../../shared/quality/quality-rule-entry";
import {
  PROJECT_DATA_SECTIONS,
  type ProjectDataSectionRevisions,
  type ProjectWriteResult,
} from "../../shared/project-event";
import { PROOFREADING_WARNING_CODES } from "../../shared/proofreading/proofreading-types";
import { JsonTool } from "../../shared/utils/json-tool";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { CacheReadPort, CacheSnapshot } from "../cache/cache-types";
import type {
  QualityRuleAnalysisCache,
  QualityRuleAnalysisCacheResult,
} from "../cache/quality-rule-analysis-cache";
import {
  apply_proofreading_item_update,
  are_proofreading_item_write_fields_equal,
  type ProofreadingItemUpdateFields,
} from "../proofreading/proofreading-item-update";
import type { ProofreadingQueryService } from "../proofreading/proofreading-query-service";
import type {
  AgentWorkspaceItemChange,
  AgentWorkspacePromptChange,
  AgentWorkspaceQualityChange,
} from "../project/project-write-request";
import type { ProjectSessionState } from "../project/project-session-state";
import type { ProjectWriteStore } from "../project/project-write-store";
import {
  AGENT_WORKSPACE_CONTRACT,
  AGENT_WORKSPACE_ITEM_FIELDS,
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_ENTRY_PATHS,
  AGENT_WORKSPACE_QUALITY_EVIDENCE_PATHS,
  AGENT_WORKSPACE_QUALITY_FIELDS,
  AGENT_WORKSPACE_RECIPE_NAMES,
  AGENT_WORKSPACE_RECIPE_PATHS,
  type AgentWorkspaceRecipeName,
  is_agent_workspace_manual_status,
  project_agent_workspace_item,
  project_agent_workspace_quality_entry,
  project_agent_workspace_warning,
} from "./agent-workspace-contract";

/** Backend Runtime 调用 Electron 沙箱的唯一可取消端口。 */
export type AgentWorkspaceRunPort = (
  request: BackendRuntimeAgentWorkspaceRunRequest,
  signal: AbortSignal,
) => Promise<BackendRuntimeAgentWorkspaceRunResponse>;

type ActiveAgentWorkspace = {
  path: string; // Backend 持有的受信任绝对目录，不进入模型结果
  projectPath: string; // create 时 loaded 工程身份
  projectEpoch: number; // 隔离同路径重新加载后的旧快照
  revisions: ProjectDataSectionRevisions; // 完整七 section 快照
  languageKey: string; // 只包含解释工作区数据所需的语言
};

/** 单个 quality kind 在 apply 回执中的稳定计数。 */
type WorkspaceQualitySummary = {
  created: number;
  updated: number;
  deleted: number;
  moved: number;
};

/** 全部可写数据集校验完成后交给唯一事务的差异集合。 */
type PreparedWorkspaceApply = {
  itemChanges: AgentWorkspaceItemChange[];
  qualityChanges: AgentWorkspaceQualityChange[];
  promptChanges: AgentWorkspacePromptChange[];
  qualitySummary: Partial<Record<QualityRuleKind, WorkspaceQualitySummary>>;
};

/** 工作区 kind 到共享重复组算法规则类型的唯一适配。 */
const DUPLICATE_RULE_TYPE_BY_KIND = Object.freeze({
  glossary: QualityRuleImportRuleTypeValue.GLOSSARY,
  pre_replacement: QualityRuleImportRuleTypeValue.PRE_REPLACEMENT,
  post_replacement: QualityRuleImportRuleTypeValue.POST_REPLACEMENT,
  text_preserve: QualityRuleImportRuleTypeValue.TEXT_PRESERVE,
} satisfies Record<QualityRuleKind, QualityRuleImportRuleType>);

/** 当前 Agent 会话唯一磁盘工作区；拥有完整快照、脚本协调和 apply 编排。 */
export class AgentWorkspaceService {
  private readonly root_path: string;
  private active: ActiveAgentWorkspace | null = null;
  private busy = false;

  /** 注入当前工程读侧、唯一写入口与 Electron 脚本端口。 */
  public constructor(
    private readonly options: {
      paths: Pick<
        AppPathService,
        "get_agent_workspace_root_dir" | "get_agent_workspace_recipe_dir"
      >;
      settings: Pick<AppSettingService, "read_setting">;
      sessionState: Pick<ProjectSessionState, "require_loaded_project_path">;
      cache: CacheReadPort;
      qualityAnalysis: Pick<QualityRuleAnalysisCache, "read">;
      proofreading: Pick<ProofreadingQueryService, "query_warnings">;
      runtimeGate: {
        run_agent_project_write(
          operation: () => Promise<ProjectWriteResult>,
        ): Promise<ProjectWriteResult>;
      };
      writeStore: Pick<ProjectWriteStore, "apply_agent_workspace_changes">;
      run: AgentWorkspaceRunPort;
      nativeFs?: NativeFs;
    },
  ) {
    this.root_path = options.paths.get_agent_workspace_root_dir();
  }

  /** 测试可替换文件系统，生产默认使用平台 NativeFs。 */
  private get native_fs(): NativeFs {
    return this.options.nativeFs ?? default_native_fs;
  }

  /** 启动时清除崩溃遗留目录，工作区从不跨应用生命周期恢复。 */
  public async initialize(): Promise<void> {
    this.active = null;
    await this.native_fs.remove_async(this.root_path, { recursive: true, force: true });
    await this.native_fs.make_dir_async(this.root_path);
  }

  /** 创建完整固定快照，所有数据成功落盘后才替换旧工作区。 */
  public async create_workspace(): Promise<JsonRecord> {
    return await this.exclusive(async () => {
      const project_path = this.options.sessionState.require_loaded_project_path();
      const start_snapshot = this.options.cache.snapshot();
      assert_snapshot_project(
        start_snapshot,
        project_path,
        "agent_workspace_create_project_changed",
      );
      const revisions = pick_workspace_revisions(start_snapshot.sectionRevisions);
      const language = read_workspace_language(this.options.settings.read_setting());
      const language_key = JsonTool.stringifyStrict(language);
      const current_items = this.options.cache.items.readItems();
      const files = this.options.cache.files.readFileEntries().map((entry) => ({
        file_path: entry.rel_path,
        file_type: entry.file_type,
      }));
      const quality_block = this.options.cache.quality.readBlock();
      const quality_entries = Object.fromEntries(
        QUALITY_RULE_KINDS.map((kind) => [kind, read_quality_entries(quality_block, kind)]),
      ) as Record<QualityRuleKind, JsonRecord[]>;
      const prompts = project_workspace_prompts(this.options.cache.prompts.readBlock());
      const [warning_result, quality_analysis_results] = await Promise.all([
        this.options.proofreading.query_warnings({
          warning_types: [...PROOFREADING_WARNING_CODES],
          keywords: [],
          scope: "all",
          offset: 0,
          limit: Number.MAX_SAFE_INTEGER,
        }),
        Promise.all(
          QUALITY_RULE_KINDS.map(
            async (kind) => [kind, await this.options.qualityAnalysis.read(kind)] as const,
          ),
        ),
      ]);
      const quality_evidence = Object.fromEntries(
        quality_analysis_results.map(([kind, result]) => [
          kind,
          project_quality_evidence(kind, result, quality_entries[kind]),
        ]),
      ) as Record<QualityRuleKind, JsonRecord>;
      assert_create_dependencies_fresh({
        projectPath: project_path,
        snapshot: start_snapshot,
        current: this.options.cache.snapshot(),
        warnings: warning_result,
        qualityAnalysis: quality_analysis_results,
        languageKey: language_key,
        currentLanguageKey: JsonTool.stringifyStrict(
          read_workspace_language(this.options.settings.read_setting()),
        ),
      });

      const project_meta: JsonRecord = {
        ...language,
        counts: {
          files: files.length,
          items: current_items.length,
          items_with_warnings: warning_result.data.items.length,
          ...Object.fromEntries(
            QUALITY_RULE_KINDS.map((kind) => [kind, quality_entries[kind].length]),
          ),
        },
        files,
      };
      const workspace_path = path.join(this.root_path, randomUUID());
      try {
        await Promise.all(
          ["items", ...QUALITY_RULE_KINDS, "recipes", "scratch"].map((directory) =>
            this.native_fs.make_dir_async(path.join(workspace_path, directory)),
          ),
        );
        const recipe_root = this.options.paths.get_agent_workspace_recipe_dir();
        await Promise.all([
          write_json_file(
            this.native_fs,
            path.join(workspace_path, AGENT_WORKSPACE_PATHS.projectMeta),
            project_meta,
          ),
          write_json_file(
            this.native_fs,
            path.join(workspace_path, AGENT_WORKSPACE_PATHS.contract),
            AGENT_WORKSPACE_CONTRACT,
          ),
          write_jsonl_file(
            this.native_fs,
            path.join(workspace_path, AGENT_WORKSPACE_PATHS.items),
            map_iterable(current_items, project_agent_workspace_item),
          ),
          write_json_file(
            this.native_fs,
            path.join(workspace_path, AGENT_WORKSPACE_PATHS.prompts),
            prompts,
          ),
          write_jsonl_file(
            this.native_fs,
            path.join(workspace_path, AGENT_WORKSPACE_PATHS.warnings),
            map_iterable(warning_result.data.items, project_agent_workspace_warning),
          ),
          ...QUALITY_RULE_KINDS.flatMap((kind) => [
            write_jsonl_file(
              this.native_fs,
              path.join(workspace_path, AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind]),
              map_iterable(quality_entries[kind], (entry) =>
                project_agent_workspace_quality_entry(kind, entry),
              ),
            ),
            write_json_file(
              this.native_fs,
              path.join(workspace_path, AGENT_WORKSPACE_QUALITY_EVIDENCE_PATHS[kind]),
              quality_evidence[kind],
            ),
          ]),
          ...AGENT_WORKSPACE_RECIPE_NAMES.map(async (name) => {
            await this.native_fs.write_file(
              path.join(workspace_path, AGENT_WORKSPACE_RECIPE_PATHS[name]),
              this.native_fs.read_file(path.join(recipe_root, `${name}.js`)),
            );
          }),
        ]);
      } catch (error) {
        await this.native_fs.remove_async(workspace_path, { recursive: true, force: true });
        throw error;
      }

      const previous = this.active;
      if (previous !== null) {
        try {
          await this.native_fs.remove_async(previous.path, { recursive: true, force: true });
        } catch (error) {
          await this.native_fs.remove_async(workspace_path, { recursive: true, force: true });
          throw error;
        }
      }
      this.active = {
        path: workspace_path,
        projectPath: project_path,
        projectEpoch: start_snapshot.epoch,
        revisions,
        languageKey: language_key,
      };
      return { project_meta, contract: AGENT_WORKSPACE_CONTRACT };
    });
  }

  /** 模型脚本由宿主事务隔离；失败只回滚本次运行。 */
  public async run_script(script: string, signal: AbortSignal): Promise<JsonValue> {
    return await this.exclusive(async () => {
      const active = this.require_active();
      await this.assert_fresh(active);
      return await this.run_workspace_operation(
        active,
        { kind: "script", script },
        "workspace_script",
        signal,
      );
    });
  }

  /** 官方 recipe 只读执行，参数已在工具 Schema 边界完成校验。 */
  public async run_recipe(
    name: AgentWorkspaceRecipeName,
    args: JsonRecord,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    return await this.exclusive(async () => {
      const active = this.require_active();
      await this.assert_fresh(active);
      return await this.run_workspace_operation(
        active,
        { kind: "recipe", name, args },
        "workspace_recipe",
        signal,
      );
    });
  }

  /** 宿主已完成回滚后才返回失败；仅明确失效时销毁活动工作区。 */
  private async run_workspace_operation(
    active: ActiveAgentWorkspace,
    operation: BackendRuntimeAgentWorkspaceRunRequest["operation"],
    action: "workspace_script" | "workspace_recipe",
    signal: AbortSignal,
  ): Promise<JsonValue> {
    let response: BackendRuntimeAgentWorkspaceRunResponse;
    try {
      response = await this.options.run({ workspacePath: active.path, operation }, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      await this.reset_active();
      throw workspace_recovery_error(error, "agent_workspace_execute_host_failed");
    }
    if (response.status === "success") return response.result;
    if (response.workspaceState === "invalidated") {
      await this.reset_active();
      throw workspace_recovery_error(
        new Error(response.message),
        `agent_workspace_${response.failure}`,
      );
    }
    throw new AppErrors.RequestValidationError({
      public_details: { action, message: response.message },
      diagnostic_context: { reason: `agent_workspace_${response.failure}` },
    });
  }

  /** 校验全部可写数据集并自动把真实差异交给一次跨 section 事务。 */
  public async apply_workspace(): Promise<JsonRecord> {
    return await this.exclusive(async () => {
      const active = this.require_active();
      await this.assert_fresh(active);
      let prepared: PreparedWorkspaceApply;
      try {
        prepared = await this.prepare_apply(active);
      } catch (error) {
        if (error instanceof AppErrors.RequestValidationError) throw error;
        await this.reset_active();
        throw workspace_recovery_error(error, "agent_workspace_apply_prepare_failed");
      }
      const has_changes =
        prepared.itemChanges.length > 0 ||
        prepared.qualityChanges.length > 0 ||
        prepared.promptChanges.length > 0;
      if (!has_changes) {
        await this.reset_active();
        return {
          status: "unchanged",
          changes: {},
          revisions: pick_apply_revisions(active.revisions),
        };
      }

      let write_result: ProjectWriteResult;
      try {
        write_result = await this.options.runtimeGate.run_agent_project_write(
          async () =>
            await this.options.writeStore.apply_agent_workspace_changes({
              projectPath: active.projectPath,
              expectedSectionRevisions: active.revisions,
              source: "agent_workspace_apply",
              itemChanges: prepared.itemChanges,
              qualityChanges: prepared.qualityChanges,
              promptChanges: prepared.promptChanges,
            }),
        );
      } catch (error) {
        await this.reset_active();
        throw workspace_recovery_error(error, "agent_workspace_apply_commit_failed");
      }
      const committed = write_result.changes.at(-1);
      if (committed === undefined) {
        await this.reset_active();
        throw workspace_validation_error("agent_workspace_write_not_confirmed", "workspace_create");
      }
      const result: JsonRecord = {
        status: "applied",
        changes: {
          ...(prepared.itemChanges.length === 0
            ? {}
            : { items: { updated: prepared.itemChanges.length } }),
          ...(prepared.qualityChanges.length === 0
            ? {}
            : { quality: prepared.qualitySummary as unknown as JsonValue }),
          ...(prepared.promptChanges.length === 0
            ? {}
            : { prompts: { updated: prepared.promptChanges.map((change) => change.kind) } }),
        },
        revisions: pick_apply_revisions(committed.sectionRevisions),
      };
      await this.reset_active();
      return result;
    });
  }

  /** 会话重置只销毁当前活动目录，不保留可恢复状态。 */
  public async reset(): Promise<void> {
    await this.reset_active();
  }

  /** 三类可写数据集必须全部校验成功后才形成一次提交请求。 */
  private async prepare_apply(active: ActiveAgentWorkspace): Promise<PreparedWorkspaceApply> {
    const itemChanges = await this.prepare_item_changes(active);
    const { changes: qualityChanges, summary: qualitySummary } =
      await this.prepare_quality_changes(active);
    const promptChanges = await this.prepare_prompt_changes(active);
    return { itemChanges, qualityChanges, promptChanges, qualitySummary };
  }

  /** items 保持固定身份与顺序，只收窄为真实人工字段差异。 */
  private async prepare_item_changes(
    active: ActiveAgentWorkspace,
  ): Promise<AgentWorkspaceItemChange[]> {
    const rows = await read_jsonl_file(
      this.native_fs,
      path.join(active.path, AGENT_WORKSPACE_PATHS.items),
    );
    const current_items = this.options.cache.items.readItems();
    if (rows.length !== current_items.length) {
      throw workspace_validation_error("agent_workspace_item_count_changed");
    }
    const changes: AgentWorkspaceItemChange[] = [];
    for (const [index, current_item] of current_items.entries()) {
      const row = rows[index];
      if (row === undefined) throw workspace_validation_error("agent_workspace_item_missing");
      assert_exact_fields(
        row,
        AGENT_WORKSPACE_ITEM_FIELDS,
        [],
        "agent_workspace_invalid_item_fields",
      );
      const current = project_agent_workspace_item(current_item);
      assert_item_identity(current, row);
      if (
        typeof row["dst"] !== "string" ||
        typeof row["name_dst"] !== "string" ||
        typeof row["status"] !== "string"
      ) {
        throw workspace_validation_error("agent_workspace_invalid_item_write");
      }
      let status: ProofreadingItemUpdateFields["status"];
      if (row["status"] !== current["status"]) {
        if (!is_agent_workspace_manual_status(row["status"])) {
          throw workspace_validation_error("agent_workspace_invalid_manual_status");
        }
        status = row["status"];
      }
      const update: ProofreadingItemUpdateFields = {
        ...(row["dst"] === current["dst"] ? {} : { dst: row["dst"] }),
        ...(row["name_dst"] === current["name_dst"] ? {} : { name_dst: row["name_dst"] }),
        ...(status === undefined ? {} : { status }),
      };
      const next = apply_proofreading_item_update(current_item as MutableJsonRecord, update);
      if (!are_proofreading_item_write_fields_equal(current_item, next)) {
        changes.push({ current: current_item as MutableJsonRecord, next });
      }
    }
    return changes;
  }

  /** 每类 quality 都按完整最终集合校验，未变化的 kind 不进入事务。 */
  private async prepare_quality_changes(active: ActiveAgentWorkspace): Promise<{
    changes: AgentWorkspaceQualityChange[];
    summary: Partial<Record<QualityRuleKind, WorkspaceQualitySummary>>;
  }> {
    const quality_block = this.options.cache.quality.readBlock();
    const changes: AgentWorkspaceQualityChange[] = [];
    const summary: Partial<Record<QualityRuleKind, WorkspaceQualitySummary>> = {};
    for (const kind of QUALITY_RULE_KINDS) {
      const rows = await read_jsonl_file(
        this.native_fs,
        path.join(active.path, AGENT_WORKSPACE_QUALITY_ENTRY_PATHS[kind]),
      );
      const current = read_quality_entries(quality_block, kind);
      const next = normalize_workspace_quality_rows(kind, current, rows);
      assert_no_new_duplicate_groups(kind, current, next);
      if (JsonTool.stringifyStrict(current) === JsonTool.stringifyStrict(next)) continue;
      changes.push({ kind, entries: next });
      summary[kind] = summarize_quality_changes(current, next);
    }
    return { changes, summary };
  }

  /** prompts 固定键集合，只提交正文真实变化。 */
  private async prepare_prompt_changes(
    active: ActiveAgentWorkspace,
  ): Promise<AgentWorkspacePromptChange[]> {
    const value = await read_json_file(
      this.native_fs,
      path.join(active.path, AGENT_WORKSPACE_PATHS.prompts),
    );
    assert_exact_fields(value, PROMPT_KINDS, [], "agent_workspace_invalid_prompts");
    const current = project_workspace_prompts(this.options.cache.prompts.readBlock());
    const changes: AgentWorkspacePromptChange[] = [];
    for (const prompt of Prompt.all()) {
      const text = value[prompt.kind];
      if (typeof text !== "string")
        throw workspace_validation_error("agent_workspace_invalid_prompt_text");
      if (text !== current[prompt.kind]) changes.push({ kind: prompt.kind, text });
    }
    return changes;
  }

  /** 任一工程身份、七 section revision 或语言变化都会废弃旧快照。 */
  private async assert_fresh(active: ActiveAgentWorkspace): Promise<void> {
    const snapshot = this.options.cache.snapshot();
    const language_key = JsonTool.stringifyStrict(
      read_workspace_language(this.options.settings.read_setting()),
    );
    const fresh =
      snapshot.projectPath === active.projectPath &&
      snapshot.epoch === active.projectEpoch &&
      language_key === active.languageKey &&
      PROJECT_DATA_SECTIONS.every(
        (section) =>
          read_json_integer(snapshot.sectionRevisions[section], 0) ===
          read_json_integer(active.revisions[section], 0),
      );
    if (fresh) return;
    await this.reset_active();
    throw workspace_validation_error("agent_workspace_stale", "workspace_create");
  }

  /** 所有需要活动工作区的入口共享同一稳定缺失错误。 */
  private require_active(): ActiveAgentWorkspace {
    if (this.active === null) {
      throw workspace_validation_error("agent_workspace_missing", "workspace_create");
    }
    return this.active;
  }

  /** 先清空内存身份再删目录，删除失败也不会复用半失效工作区。 */
  private async reset_active(): Promise<void> {
    const active = this.active;
    this.active = null;
    if (active !== null) {
      await this.native_fs.remove_async(active.path, { recursive: true, force: true });
    }
  }

  /** create、run 与 apply 在服务内串行，避免活动目录被交叉替换。 */
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new AppErrors.RuntimeBusyError();
    this.busy = true;
    try {
      return await action();
    } finally {
      this.busy = false;
    }
  }
}

/** AgentService 只依赖工作区生命周期，不接触领域协作者。 */
export type AgentWorkspacePort = Pick<
  AgentWorkspaceService,
  "initialize" | "create_workspace" | "run_recipe" | "run_script" | "apply_workspace" | "reset"
>;

/** project_meta 只暴露解释快照所需的权威语言，不复制完整设置。 */
function read_workspace_language(value: unknown): JsonRecord {
  const settings = normalize_setting_snapshot(value);
  return {
    source_language: settings.source_language,
    target_language: settings.target_language,
  };
}

/** 固定补齐七个 section revision，缺失值只在边界归零。 */
function pick_workspace_revisions(
  revisions: ProjectDataSectionRevisions,
): ProjectDataSectionRevisions {
  return Object.fromEntries(
    PROJECT_DATA_SECTIONS.map((section) => [section, read_json_integer(revisions[section], 0)]),
  );
}

/** apply 回执只返回四个可能变化的 section。 */
function pick_apply_revisions(revisions: ProjectDataSectionRevisions): JsonRecord {
  return Object.fromEntries(
    (["items", "proofreading", "quality", "prompts"] as const).map((section) => [
      section,
      read_json_integer(revisions[section], 0),
    ]),
  );
}

/** 当前质量规则先走共享规范化，再补齐旧工程缺失的稳定 ID。 */
function read_quality_entries(quality: JsonRecord, kind: QualityRuleKind): JsonRecord[] {
  const entries = normalize_quality_rule_entries(
    QualityRule.from_json(kind),
    read_json_record(quality[kind])["entries"] ?? [],
  ) as JsonRecord[];
  return ensure_quality_rule_entry_ids(entries);
}

/** prompts 工作区只投影两类固定正文，不暴露 enabled 与局部 revision。 */
function project_workspace_prompts(block: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Prompt.all().map((prompt) => [prompt.kind, prompt.normalize_slice(block[prompt.kind]).text]),
  );
}

/** 质量证据必须与规则集合的稳定 ID 顺序完全一致。 */
function project_quality_evidence(
  kind: QualityRuleKind,
  result: QualityRuleAnalysisCacheResult,
  entries: JsonRecord[],
): JsonRecord {
  const expected_ids = entries.map((entry) => String(entry["entry_id"] ?? ""));
  if (
    JsonTool.stringifyStrict(result.analysis.entry_ids) !== JsonTool.stringifyStrict(expected_ids)
  ) {
    throw workspace_validation_error(
      `agent_workspace_quality_analysis_order_changed_${kind}`,
      "workspace_create",
    );
  }
  return {
    by_id: Object.fromEntries(
      expected_ids.map((id) => [
        id,
        {
          hits: result.analysis.hits_by_entry_id[id] ?? 0,
          examples: [...(result.analysis.examples_by_entry_id[id] ?? [])],
          parent_sources: [...(result.analysis.relations.subset_parents_by_entry_id[id] ?? [])],
        },
      ]),
    ),
    groups: result.analysis.relations.groups.map((group) => [...group]),
  };
}

/** create 起点必须属于当前 loaded 工程。 */
function assert_snapshot_project(
  snapshot: CacheSnapshot,
  project_path: string,
  reason: string,
): void {
  if (snapshot.projectPath !== project_path) {
    throw workspace_validation_error(reason, "workspace_create");
  }
}

/** 异步派生数据读取完成后复核所有依赖仍属于同一快照。 */
function assert_create_dependencies_fresh(args: {
  projectPath: string;
  snapshot: CacheSnapshot;
  current: CacheSnapshot;
  warnings: { projectPath: string; sectionRevisions: ProjectDataSectionRevisions };
  qualityAnalysis: Array<readonly [QualityRuleKind, QualityRuleAnalysisCacheResult]>;
  languageKey: string;
  currentLanguageKey: string;
}): void {
  const same_snapshot =
    args.current.projectPath === args.snapshot.projectPath &&
    args.current.epoch === args.snapshot.epoch &&
    PROJECT_DATA_SECTIONS.every(
      (section) =>
        read_json_integer(args.current.sectionRevisions[section], 0) ===
        read_json_integer(args.snapshot.sectionRevisions[section], 0),
    );
  const warnings_fresh =
    args.warnings.projectPath === args.projectPath &&
    (["items", "quality", "proofreading"] as const).every(
      (section) =>
        read_json_integer(args.warnings.sectionRevisions[section], 0) ===
        read_json_integer(args.snapshot.sectionRevisions[section], 0),
    );
  const analyses_fresh = args.qualityAnalysis.every(
    ([, result]) =>
      result.projectPath === args.projectPath &&
      read_json_integer(result.sectionRevisions["items"], 0) ===
        read_json_integer(args.snapshot.sectionRevisions["items"], 0) &&
      read_json_integer(result.sectionRevisions["quality"], 0) ===
        read_json_integer(args.snapshot.sectionRevisions["quality"], 0),
  );
  if (
    !same_snapshot ||
    !warnings_fresh ||
    !analyses_fresh ||
    args.languageKey !== args.currentLanguageKey
  ) {
    throw workspace_validation_error(
      "agent_workspace_create_dependencies_changed",
      "workspace_create",
    );
  }
}

/** 可写 quality 行校验字段、身份与真实执行语义后恢复内部形状。 */
function normalize_workspace_quality_rows(
  kind: QualityRuleKind,
  current: JsonRecord[],
  rows: JsonRecord[],
): JsonRecord[] {
  const current_ids = new Set(current.map((entry) => String(entry["entry_id"] ?? "")));
  const next_ids = new Set<string>();
  const raw_entries = rows.map((row) => {
    assert_exact_fields(
      row,
      AGENT_WORKSPACE_QUALITY_FIELDS[kind],
      ["id"],
      "agent_workspace_invalid_quality_fields",
    );
    for (const field of AGENT_WORKSPACE_QUALITY_FIELDS[kind]) {
      if (field === "id") continue;
      const value = row[field];
      const boolean_field = field === "regex" || field === "case_sensitive";
      if (
        (boolean_field && typeof value !== "boolean") ||
        (!boolean_field && typeof value !== "string")
      ) {
        throw workspace_validation_error("agent_workspace_invalid_quality_field_type");
      }
    }
    const raw_id = row["id"];
    const entry_id = raw_id === undefined ? create_quality_rule_entry_id() : String(raw_id).trim();
    if (
      entry_id === "" ||
      next_ids.has(entry_id) ||
      (raw_id !== undefined && (typeof raw_id !== "string" || !current_ids.has(entry_id)))
    ) {
      throw workspace_validation_error("agent_workspace_invalid_quality_id");
    }
    next_ids.add(entry_id);
    return {
      entry_id,
      ...Object.fromEntries(Object.entries(row).filter(([field]) => field !== "id")),
    } as JsonRecord;
  });
  try {
    return normalize_quality_rule_entries(QualityRule.from_json(kind), raw_entries) as JsonRecord[];
  } catch (cause) {
    throw new AppErrors.RequestValidationError({
      cause,
      diagnostic_context: { reason: "agent_workspace_invalid_quality", kind },
    });
  }
}

/** 允许保留既有重复事实，但拒绝新建或扩大重复组。 */
function assert_no_new_duplicate_groups(
  kind: QualityRuleKind,
  previous: JsonRecord[],
  next: JsonRecord[],
): void {
  const rule_type = DUPLICATE_RULE_TYPE_BY_KIND[kind];
  const previous_counts = new Map(
    collect_quality_rule_duplicate_groups({ rule_type, entries: previous }).map((group) => [
      group.key,
      group.indexes.length,
    ]),
  );
  const conflict = collect_quality_rule_duplicate_groups({ rule_type, entries: next }).find(
    (group) => group.indexes.length > (previous_counts.get(group.key) ?? 1),
  );
  if (conflict !== undefined) {
    throw workspace_validation_error("agent_workspace_quality_duplicate_expanded");
  }
}

/** 回执按稳定 ID 统计创建、字段更新、删除与位置变化。 */
function summarize_quality_changes(
  current: JsonRecord[],
  next: JsonRecord[],
): WorkspaceQualitySummary {
  const current_by_id = new Map(current.map((entry) => [String(entry["entry_id"]), entry]));
  const next_by_id = new Map(next.map((entry) => [String(entry["entry_id"]), entry]));
  const current_retained = current
    .map((entry) => String(entry["entry_id"]))
    .filter((id) => next_by_id.has(id));
  const next_retained = next
    .map((entry) => String(entry["entry_id"]))
    .filter((id) => current_by_id.has(id));
  return {
    created: next.filter((entry) => !current_by_id.has(String(entry["entry_id"]))).length,
    updated: next.filter((entry) => {
      const previous = current_by_id.get(String(entry["entry_id"]));
      return (
        previous !== undefined &&
        JsonTool.stringifyStrict(previous) !== JsonTool.stringifyStrict(entry)
      );
    }).length,
    deleted: current.filter((entry) => !next_by_id.has(String(entry["entry_id"]))).length,
    moved: next_retained.filter((id, index) => current_retained[index] !== id).length,
  };
}

/** item 的位置、原文和重试事实都不允许由工作区改写。 */
function assert_item_identity(current: JsonRecord, target: JsonRecord): void {
  const immutable_fields = ["item_id", "src", "name_src", "file_path", "row_number", "retry_count"];
  if (immutable_fields.some((field) => target[field] !== current[field])) {
    throw workspace_validation_error("agent_workspace_item_identity_changed");
  }
}

/** 固定文件拒绝未知字段，并要求所有非可选字段存在。 */
function assert_exact_fields(
  value: JsonRecord,
  fields: readonly string[],
  optional: readonly string[],
  reason: string,
): void {
  const unknown = Object.keys(value).find((field) => !fields.includes(field));
  const missing = fields.find(
    (field) => !optional.includes(field) && !Object.prototype.hasOwnProperty.call(value, field),
  );
  if (unknown !== undefined || missing !== undefined) {
    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason, field: unknown ?? missing },
    });
  }
}

/** JSON 文件统一使用严格序列化和结尾换行。 */
async function write_json_file(
  native_fs: NativeFs,
  file_path: string,
  value: JsonRecord,
): Promise<void> {
  await native_fs.write_file(file_path, `${JsonTool.stringifyStrict(value, { indent: 2 })}\n`);
}

/** 延迟执行边界投影，避免为 JSONL 写入再保留一份完整数组。 */
function* map_iterable<T>(
  values: Iterable<T>,
  project: (value: T) => JsonRecord,
): Generator<JsonRecord> {
  for (const value of values) yield project(value);
}

/** JSONL 逐行写入，避免 create 再构造完整文本副本。 */
async function write_jsonl_file(
  native_fs: NativeFs,
  file_path: string,
  values: Iterable<JsonRecord>,
): Promise<void> {
  await pipeline(
    Readable.from(
      (function* () {
        for (const value of values) yield `${JsonTool.stringifyStrict(value)}\n`;
      })(),
    ),
    native_fs.create_write_stream(file_path),
  );
}

/** 可写 JSON 解析失败统一归类为可修复校验错误。 */
async function read_json_file(native_fs: NativeFs, file_path: string): Promise<JsonRecord> {
  try {
    const value = JsonTool.parseStrict(native_fs.read_text_file(file_path));
    if (!is_json_record(value)) throw new TypeError("工作区 JSON 必须是对象");
    return value;
  } catch (cause) {
    throw new AppErrors.RequestValidationError({
      cause,
      diagnostic_context: { reason: "agent_workspace_invalid_json" },
    });
  }
}

/** 可写 JSONL 逐行解析并保留准确行号诊断。 */
async function read_jsonl_file(native_fs: NativeFs, file_path: string): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  let lines: readline.Interface | null = null;
  try {
    lines = readline.createInterface({
      input: native_fs.create_read_stream(file_path),
      crlfDelay: Infinity,
    });
    let line_number = 0;
    for await (const line of lines) {
      line_number += 1;
      if (line.trim() === "") continue;
      const parsed = JsonTool.parseStrict(line);
      if (!is_json_record(parsed)) {
        throw new TypeError(`工作区 JSONL 第 ${line_number.toString()} 行不是对象`);
      }
      rows.push(parsed);
    }
    return rows;
  } catch (cause) {
    throw new AppErrors.RequestValidationError({
      cause,
      diagnostic_context: { reason: "agent_workspace_invalid_jsonl" },
    });
  } finally {
    lines?.close();
  }
}

/** 工作区校验错误默认要求修复当前可写数据集，stale 才要求重新 create。 */
function workspace_validation_error(
  reason: string,
  action: "workspace_create" | "workspace_script" = "workspace_script",
): AppErrors.RequestValidationError {
  return new AppErrors.RequestValidationError({
    public_details: { action },
    diagnostic_context: { reason },
  });
}

/** 工作区已销毁的失败统一告诉模型重新 create，同时保留已知错误码和原始诊断。 */
function workspace_recovery_error(error: unknown, reason: string): AppErrors.AppError {
  if (AppErrors.is_app_error(error)) {
    return new AppErrors.AppError({
      code: error.code,
      cause: error,
      public_details: { ...error.public_details, action: "workspace_create" },
      diagnostic_context: { ...error.diagnostic_context, reason },
    });
  }
  return new AppErrors.InternalInvariantError({
    cause: error,
    public_details: { action: "workspace_create" },
    diagnostic_context: { reason },
  });
}
