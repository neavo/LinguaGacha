import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  read_json_integer,
  read_json_record,
  type JsonRecord,
  type JsonValue,
} from "../../domain/json";
import { Prompt } from "../../domain/prompt";
import { QualityRule, QUALITY_RULE_KINDS, type QualityRuleKind } from "../../domain/quality";
import { normalize_setting_snapshot } from "../../domain/setting";
import type {
  BackendRuntimeAgentWorkspaceRunRequest,
  BackendRuntimeAgentWorkspaceRunResponse,
} from "../../shared/backend-runtime";
import * as AppErrors from "../../shared/error";
import { ensure_quality_rule_entry_ids } from "../../shared/quality/quality-rule-entry-id";
import { normalize_quality_rule_entries } from "../../shared/quality/quality-rule-entry";
import {
  PROJECT_DATA_SECTIONS,
  type ProjectDataSectionRevisions,
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
import type { LogManager } from "../log/log-manager";
import type { ProofreadingQueryService } from "../proofreading/proofreading-query-service";
import type { AgentWorkspaceApplyAck } from "../project/project-write-request";
import type { ProjectSessionState } from "../project/project-session-state";
import type { ProjectWriteStore } from "../project/project-write-store";
import {
  prepare_agent_workspace_changes,
  type PreparedAgentWorkspaceChanges,
} from "./agent-workspace-change";
import {
  AGENT_WORKSPACE_CHANGE_PATHS,
  AGENT_WORKSPACE_CONTRACT,
  AGENT_WORKSPACE_PATHS,
  AGENT_WORKSPACE_QUALITY_CHANGE_OPERATIONS,
  AGENT_WORKSPACE_QUALITY_CHANGE_PATHS,
  AGENT_WORKSPACE_QUALITY_ENTRY_PATHS,
  AGENT_WORKSPACE_QUALITY_EVIDENCE_PATHS,
  AGENT_WORKSPACE_RECIPE_NAMES,
  AGENT_WORKSPACE_RECIPE_PATHS,
  type AgentWorkspaceRecipeName,
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
  projectPath: string; // load 时 loaded 工程身份
  projectEpoch: number; // 隔离同路径重新加载后的旧快照
  revisions: ProjectDataSectionRevisions; // 完整七 section 快照
  languageKey: string; // 只包含解释工作区数据所需的语言
};

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
          operation: () => Promise<AgentWorkspaceApplyAck>,
        ): Promise<AgentWorkspaceApplyAck>;
      };
      writeStore: Pick<ProjectWriteStore, "apply_agent_workspace_changes">;
      logManager: Pick<LogManager, "warning">;
      run: AgentWorkspaceRunPort;
      nativeFs?: NativeFs;
    },
  ) {
    this.root_path = options.paths.get_agent_workspace_root_dir();
  }

  /** 生产默认使用共享 NativeFs，测试只在显式注入时替换。 */
  private get native_fs(): NativeFs {
    return this.options.nativeFs ?? default_native_fs;
  }

  /** 启动时清除崩溃遗留目录，工作区从不跨应用生命周期恢复。 */
  public async initialize(): Promise<void> {
    this.active = null;
    await this.native_fs.remove_async(this.root_path, { recursive: true, force: true });
    await this.native_fs.make_dir_async(this.root_path);
  }

  /** 加载完整只读快照，并同时创建空的显式 change 文件。 */
  public async load_workspace(): Promise<JsonRecord> {
    return await this.exclusive(async () => {
      const project_path = this.options.sessionState.require_loaded_project_path();
      const start_snapshot = this.options.cache.snapshot();
      assert_snapshot_project(start_snapshot, project_path, "agent_workspace_load_project_changed");
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
      assert_load_dependencies_fresh({
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
        const recipe_root = this.options.paths.get_agent_workspace_recipe_dir();
        // 所有并行写入必须结算后再清理；否则迟到写入会在失败目录删除后复活半成品。
        const write_results = await Promise.allSettled([
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
          ...all_change_paths().map((relative_path) =>
            this.native_fs.write_file(path.join(workspace_path, relative_path), ""),
          ),
          ...AGENT_WORKSPACE_RECIPE_NAMES.map(async (name) => {
            await this.native_fs.write_file(
              path.join(workspace_path, AGENT_WORKSPACE_RECIPE_PATHS[name]),
              this.native_fs.read_file(path.join(recipe_root, `${name}.js`)),
            );
          }),
          this.native_fs.make_dir_async(path.join(workspace_path, "scratch")),
        ]);
        const write_failure = write_results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (write_failure !== undefined) throw write_failure.reason;
      } catch (error) {
        await this.remove_workspace_directory(workspace_path);
        throw error;
      }

      const previous = this.active;
      this.active = {
        path: workspace_path,
        projectPath: project_path,
        projectEpoch: start_snapshot.epoch,
        revisions,
        languageKey: language_key,
      };
      if (previous !== null) await this.remove_workspace_directory(previous.path);
      return {
        status: "loaded",
        ...language,
        counts: project_meta["counts"],
      };
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
      await this.discard_active();
      throw workspace_recovery_error(error, "agent_workspace_execute_host_failed");
    }
    if (response.status === "success") return response.result;
    if (response.workspaceState === "invalidated") {
      await this.discard_active();
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

  /** 校验显式 change，并把真实局部修改交给一次跨 section 事务。 */
  public async apply_workspace(): Promise<JsonRecord> {
    return await this.exclusive(async () => {
      const active = this.require_active();
      await this.assert_fresh(active);
      let prepared: PreparedAgentWorkspaceChanges;
      try {
        prepared = await prepare_agent_workspace_changes({
          nativeFs: this.native_fs,
          workspacePath: active.path,
          cache: this.options.cache,
        });
      } catch (error) {
        if (error instanceof AppErrors.RequestValidationError) throw error;
        await this.discard_active();
        throw workspace_recovery_error(error, "agent_workspace_apply_prepare_failed");
      }
      if (!has_prepared_changes(prepared)) {
        await this.discard_active();
        return {
          status: "unchanged",
          changes: {},
          revisions: pick_apply_revisions(active.revisions),
        };
      }

      let write_ack: AgentWorkspaceApplyAck;
      try {
        write_ack = await this.options.runtimeGate.run_agent_project_write(
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
        if (error instanceof AppErrors.CommittedChangeSyncError) {
          await this.discard_active();
          throw error;
        }
        if (error instanceof AppErrors.RevisionConflictError) {
          await this.discard_active();
          throw workspace_error_with_action(error, "workspace_load");
        }
        throw workspace_error_with_action(error, "workspace_apply");
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
        revisions: pick_apply_revisions(write_ack.sectionRevisions),
      };
      await this.discard_active();
      return result;
    });
  }

  /** 会话重置只销毁当前活动目录，不保留跨任务恢复状态。 */
  public async reset(): Promise<void> {
    await this.discard_active();
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
    await this.discard_active();
    throw workspace_validation_error("agent_workspace_stale", "workspace_load");
  }

  /** 所有 run/apply 都要求已经成功完成一次 load。 */
  private require_active(): ActiveAgentWorkspace {
    if (this.active === null) {
      throw workspace_validation_error("agent_workspace_missing", "workspace_load");
    }
    return this.active;
  }

  /** 先清空内存身份；临时目录清理失败不改变已经完成的项目事实或隔离。 */
  private async discard_active(): Promise<void> {
    const active = this.active;
    this.active = null;
    if (active !== null) await this.remove_workspace_directory(active.path);
  }

  /** 临时目录清理是尽力而为；活动身份已先解除，失败只进入诊断。 */
  private async remove_workspace_directory(workspace_path: string): Promise<void> {
    try {
      await this.native_fs.remove_async(workspace_path, { recursive: true, force: true });
    } catch (error) {
      this.options.logManager.warning("Agent 工作区临时目录清理失败。", {
        source: "agent_workspace",
        error,
      });
    }
  }

  /** load、run 与 apply 在服务内串行，避免活动目录被交叉替换。 */
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
  "initialize" | "load_workspace" | "run_recipe" | "run_script" | "apply_workspace" | "reset"
>;

/** apply 只有至少一个领域存在真实变化时才进入项目写入口。 */
function has_prepared_changes(prepared: PreparedAgentWorkspaceChanges): boolean {
  return (
    prepared.itemChanges.length > 0 ||
    prepared.qualityChanges.length > 0 ||
    prepared.promptChanges.length > 0
  );
}

/** 固定 change 路径只从共享 contract 词表展开，避免宿主与 Backend 分叉。 */
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

/** 工作区只冻结解释业务数据所需的源语言与目标语言。 */
function read_workspace_language(value: unknown): JsonRecord {
  const settings = normalize_setting_snapshot(value);
  return {
    source_language: settings.source_language,
    target_language: settings.target_language,
  };
}

/** load 时复制完整七 section revision，隔离 cache 返回的可变引用。 */
function pick_workspace_revisions(
  revisions: ProjectDataSectionRevisions,
): ProjectDataSectionRevisions {
  return Object.fromEntries(
    PROJECT_DATA_SECTIONS.map((section) => [section, read_json_integer(revisions[section], 0)]),
  );
}

/** apply 回执只暴露本工具可能改变的四个 section。 */
function pick_apply_revisions(revisions: ProjectDataSectionRevisions): JsonRecord {
  return Object.fromEntries(
    (["items", "proofreading", "quality", "prompts"] as const).map((section) => [
      section,
      read_json_integer(revisions[section], 0),
    ]),
  );
}

/** quality 快照复用生产归一化与迁移期稳定 ID。 */
function read_quality_entries(quality: JsonRecord, kind: QualityRuleKind): JsonRecord[] {
  const entries = normalize_quality_rule_entries(
    QualityRule.from_json(kind),
    read_json_record(quality[kind])["entries"] ?? [],
  ) as JsonRecord[];
  return ensure_quality_rule_entry_ids(entries);
}

/** prompt 快照只保留固定正文，不复制功能开关。 */
function project_workspace_prompts(block: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Prompt.all().map((prompt) => [prompt.kind, prompt.normalize_slice(block[prompt.kind]).text]),
  );
}

/** 把共享分析缓存投影为与当前规则顺序严格同源的只读证据。 */
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
      "workspace_load",
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

/** sessionState 与 cache 必须指向同一 loaded 工程。 */
function assert_snapshot_project(
  snapshot: CacheSnapshot,
  project_path: string,
  reason: string,
): void {
  if (snapshot.projectPath !== project_path) {
    throw workspace_validation_error(reason, "workspace_load");
  }
}

/** 异步派生数据全部完成后复核依赖，禁止落盘混合时点快照。 */
function assert_load_dependencies_fresh(args: {
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
    throw workspace_validation_error("agent_workspace_load_dependencies_changed", "workspace_load");
  }
}

/** JSON 固定使用严格序列化、两空格缩进和结尾换行。 */
async function write_json_file(
  native_fs: NativeFs,
  file_path: string,
  value: JsonRecord,
): Promise<void> {
  await native_fs.write_file(file_path, `${JsonTool.stringifyStrict(value, { indent: 2 })}\n`);
}

/** 边界投影保持惰性，避免 JSONL 落盘前再复制一份完整数组。 */
function* map_iterable<T>(
  values: Iterable<T>,
  project: (value: T) => JsonRecord,
): Generator<JsonRecord> {
  for (const value of values) yield project(value);
}

/** JSONL 逐条严格序列化到流，空集合仍会创建固定文件。 */
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

/** 工作区业务校验统一返回下一步恢复动作。 */
function workspace_validation_error(
  reason: string,
  action: "workspace_load" | "workspace_script" = "workspace_script",
): AppErrors.RequestValidationError {
  return new AppErrors.RequestValidationError({
    public_details: { action },
    diagnostic_context: { reason },
  });
}

/** 无法继续使用当前目录的错误统一要求重新 load。 */
function workspace_recovery_error(error: unknown, reason: string): AppErrors.AppError {
  return workspace_error_with_action(error, "workspace_load", reason);
}

/** 包装错误时保留稳定 code、公开详情、诊断上下文和原始 cause。 */
function workspace_error_with_action(
  error: unknown,
  action: "workspace_load" | "workspace_apply",
  reason?: string,
): AppErrors.AppError {
  if (AppErrors.is_app_error(error)) {
    return new AppErrors.AppError({
      code: error.code,
      cause: error,
      public_details: { ...error.public_details, action },
      diagnostic_context: {
        ...error.diagnostic_context,
        ...(reason === undefined ? {} : { reason }),
      },
    });
  }
  return new AppErrors.InternalInvariantError({
    cause: error,
    public_details: { action },
    diagnostic_context: reason === undefined ? {} : { reason },
  });
}
