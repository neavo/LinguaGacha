import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import readline from "node:readline";

import { is_item_status } from "../../domain/item";
import {
  is_json_record,
  read_json_integer,
  read_json_record,
  type JsonRecord,
  type JsonValue,
} from "../../domain/json";
import { QualityRule, QUALITY_RULE_KINDS } from "../../domain/quality";
import { normalize_setting_snapshot } from "../../domain/setting";
import {
  PROOFREADING_MANUAL_STATUS_CODES,
  PROOFREADING_WARNING_CODES,
} from "../../shared/proofreading/proofreading-types";
import type {
  ProjectDataSection,
  ProjectDataSectionRevisions,
  ProjectWriteResult,
} from "../../shared/project-event";
import { create_quality_rule_entry_id } from "../../shared/quality/quality-rule-entry-id";
import { normalize_quality_rule_entries } from "../../shared/quality/quality-rule-entry";
import { JsonTool } from "../../shared/utils/json-tool";
import type {
  BackendRuntimeAgentWorkspaceRunRequest,
  BackendRuntimeAgentWorkspaceRunResponse,
} from "../../shared/backend-runtime";
import * as AppErrors from "../../shared/error";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import type { AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { CacheReadPort } from "../cache/cache-types";
import type { ProjectSessionState } from "../project/project-session-state";
import type { ProofreadingQueryService } from "../proofreading/proofreading-query-service";
import type { ProofreadingService } from "../proofreading/proofreading-service";
import type { QualityRuleService } from "../quality/quality-rule-service";
import { project_agent_item, project_warning_item } from "./agent-item-tools";

/** 一次工作区只允许一个可导回工程的业务目标。 */
export type AgentWorkspaceTarget = "items" | "glossary";

/** Backend Runtime 调用 Electron 沙箱的唯一可取消端口。 */
export type AgentWorkspaceRunPort = (
  request: BackendRuntimeAgentWorkspaceRunRequest,
  signal: AbortSignal,
) => Promise<BackendRuntimeAgentWorkspaceRunResponse>;

// 工作区读取的任一项目事实变化都要求重新导出，project section 不参与当前上下文。
const WORKSPACE_DEPENDENCY_SECTIONS = [
  "files",
  "items",
  "quality",
  "prompts",
  "analysis",
  "proofreading",
] as const satisfies readonly ProjectDataSection[];

// target 行只允许公开字段，导入时据此拒绝模型追加的旁路数据。
const WORKSPACE_ITEM_FIELDS = [
  "item_id",
  "src",
  "dst",
  "name_src",
  "name_dst",
  "file_path",
  "row_number",
  "status",
  "retry_count",
] as const;

const WORKSPACE_GLOSSARY_FIELDS = ["id", "src", "dst", "info", "case_sensitive"] as const; // 最终集合不接受 enabled、mode 等切片级状态

type ActiveAgentWorkspace = {
  path: string; // Backend 持有的受信任绝对目录，不进入模型结果
  target: AgentWorkspaceTarget; // 唯一允许导回工程的数据类型
  projectPath: string; // 导出时 loaded 工程身份
  projectEpoch: number; // 隔离同路径重新加载后的旧快照
  revisions: ProjectDataSectionRevisions; // 所有导出依赖的固定 revision
  settingsKey: string; // 影响文本解释的设置窄快照
};

type WorkspaceProofreading = {
  query: Pick<ProofreadingQueryService, "query_warnings">; // 导出只读 warning 证据
  commands: Pick<ProofreadingService, "update_items_from_agent_workspace">; // 唯一 items 导入写口
};

/**
 * 当前 Agent 会话唯一磁盘工作区；只负责文件快照、脚本协调与领域导入。
 */
export class AgentWorkspaceService {
  private readonly root_path: string; // 崩溃清理与会话工作区共用的唯一根目录
  private active: ActiveAgentWorkspace | null = null; // 当前唯一可运行、可导入的快照
  private busy = false; // 三个工具共用的进程内串行门，避免替换与导入交错

  /** 固定一次性目录、项目读口和两个领域写口，不自行持有项目事实。 */
  public constructor(
    private readonly options: {
      paths: Pick<AppPathService, "get_agent_workspace_root_dir">;
      settings: Pick<AppSettingService, "read_setting">;
      sessionState: Pick<ProjectSessionState, "require_loaded_project_path">;
      cache: CacheReadPort;
      proofreading: WorkspaceProofreading;
      qualityRules: Pick<QualityRuleService, "update_from_agent">;
      readAnalysisCandidates: () => JsonRecord;
      run: AgentWorkspaceRunPort;
      nativeFs?: NativeFs;
    },
  ) {
    this.root_path = options.paths.get_agent_workspace_root_dir();
  }

  /** 测试可替换文件系统门面，生产默认复用平台路径策略。 */
  private get native_fs(): NativeFs {
    return this.options.nativeFs ?? default_native_fs;
  }

  /** 启动时清除崩溃遗留目录，工作区从不跨应用生命周期恢复。 */
  public async initialize(): Promise<void> {
    this.active = null;
    await this.native_fs.remove_async(this.root_path, { recursive: true, force: true });
    await this.native_fs.make_dir_async(this.root_path);
  }

  /** 导出固定完整上下文，成功后才替换当前工作区。 */
  public async export_workspace(target: AgentWorkspaceTarget): Promise<JsonRecord> {
    return await this.exclusive(async () => {
      const project_path = this.options.sessionState.require_loaded_project_path();
      const items = this.options.cache.items.readItems().map(project_agent_item);
      const files = this.options.cache.files.readFileEntries();
      const quality = this.options.cache.quality.readBlock();
      const prompts = this.options.cache.prompts.readBlock();
      const analysis = this.options.cache.analysis.readBlock();
      const warning_result = await this.options.proofreading.query.query_warnings({
        warning_types: [...PROOFREADING_WARNING_CODES],
        keywords: [],
        scope: "all",
        offset: 0,
        limit: Number.MAX_SAFE_INTEGER,
      });
      const warnings = warning_result.data.items.map(project_warning_item);
      const snapshot = this.options.cache.snapshot();
      if (snapshot.projectPath !== project_path) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "agent_workspace_project_changed_during_export" },
        });
      }
      const workspace_path = path.join(this.root_path, randomUUID());
      const glossary_entries = read_quality_entries(quality, "glossary").map(
        project_workspace_quality_entry,
      );
      const settings = read_workspace_settings(this.options.settings.read_setting());
      const analysis_candidates =
        target === "glossary"
          ? Object.values(
              read_json_record(this.options.readAnalysisCandidates()["candidate_aggregate"]),
            ).filter(is_json_record)
          : [];
      const file_paths = [
        "manifest.json",
        target === "items" ? "target/items.jsonl" : "context/items.jsonl",
        target === "glossary" ? "target/glossary.jsonl" : "context/quality/glossary.jsonl",
        "context/files.jsonl",
        "context/warnings.jsonl",
        "context/project.json",
        "context/quality.json",
        "context/quality/text_preserve.jsonl",
        "context/quality/pre_replacement.jsonl",
        "context/quality/post_replacement.jsonl",
        "context/prompts.json",
        "context/analysis.json",
        ...(target === "glossary" ? ["context/analysis_candidates.jsonl"] : []),
      ];
      const manifest: JsonRecord = {
        version: 1,
        target,
        files: file_paths,
        counts: {
          items: items.length,
          warnings: warnings.length,
          glossary: glossary_entries.length,
          analysis_candidates: analysis_candidates.length,
        },
        revisions: pick_workspace_revisions(snapshot.sectionRevisions),
        writable_paths: [
          target === "items" ? "target/items.jsonl" : "target/glossary.jsonl",
          "scratch/",
        ],
        target_semantics:
          target === "items"
            ? {
                fields: [...WORKSPACE_ITEM_FIELDS],
                editable_fields: ["dst", "name_dst", "status"],
                status_values: [...PROOFREADING_MANUAL_STATUS_CODES],
                preserve_order: true,
                note: "修改非空 dst 会自动置为 PROCESSED；同一行显式修改 status 时以后者为准。",
              }
            : {
                fields: [...WORKSPACE_GLOSSARY_FIELDS],
                final_ordered_collection: true,
                existing_id_is_immutable: true,
                new_entry_omits_id: true,
              },
        script_api: [
          "readText",
          "readJson",
          "readLines",
          "readJsonl",
          "writeText",
          "writeJson",
          "writeJsonl",
          "list",
          "remove",
        ],
      };
      try {
        await this.native_fs.make_dir_async(path.join(workspace_path, "target"));
        await this.native_fs.make_dir_async(path.join(workspace_path, "context", "quality"));
        await this.native_fs.make_dir_async(path.join(workspace_path, "scratch"));
        await Promise.all([
          write_json_file(this.native_fs, path.join(workspace_path, "manifest.json"), manifest),
          write_jsonl_file(
            this.native_fs,
            path.join(
              workspace_path,
              target === "items" ? "target/items.jsonl" : "context/items.jsonl",
            ),
            items,
          ),
          write_jsonl_file(
            this.native_fs,
            path.join(
              workspace_path,
              target === "glossary" ? "target/glossary.jsonl" : "context/quality/glossary.jsonl",
            ),
            glossary_entries,
          ),
          write_jsonl_file(this.native_fs, path.join(workspace_path, "context/files.jsonl"), files),
          write_jsonl_file(
            this.native_fs,
            path.join(workspace_path, "context/warnings.jsonl"),
            warnings,
          ),
          write_json_file(this.native_fs, path.join(workspace_path, "context/project.json"), {
            ...settings,
            revisions: pick_workspace_revisions(snapshot.sectionRevisions),
          }),
          write_json_file(
            this.native_fs,
            path.join(workspace_path, "context/quality.json"),
            project_quality_settings(quality),
          ),
          ...QUALITY_RULE_KINDS.filter((kind) => kind !== "glossary").map((kind) =>
            write_jsonl_file(
              this.native_fs,
              path.join(workspace_path, "context", "quality", `${kind}.jsonl`),
              read_quality_entries(quality, kind).map(project_workspace_quality_entry),
            ),
          ),
          write_json_file(
            this.native_fs,
            path.join(workspace_path, "context/prompts.json"),
            prompts,
          ),
          write_json_file(
            this.native_fs,
            path.join(workspace_path, "context/analysis.json"),
            analysis,
          ),
          ...(target === "glossary"
            ? [
                write_jsonl_file(
                  this.native_fs,
                  path.join(workspace_path, "context/analysis_candidates.jsonl"),
                  analysis_candidates,
                ),
              ]
            : []),
        ]);
      } catch (error) {
        await this.native_fs.remove_async(workspace_path, { recursive: true, force: true });
        throw error;
      }
      const previous = this.active;
      const next: ActiveAgentWorkspace = {
        path: workspace_path,
        target,
        projectPath: project_path,
        projectEpoch: snapshot.epoch,
        revisions: pick_workspace_revisions(snapshot.sectionRevisions),
        settingsKey: JsonTool.stringifyStrict(settings),
      };
      if (previous !== null) {
        try {
          await this.native_fs.remove_async(previous.path, { recursive: true, force: true });
        } catch (error) {
          await this.native_fs.remove_async(workspace_path, { recursive: true, force: true });
          throw error;
        }
      }
      this.active = next;
      return manifest;
    });
  }

  /** 失败脚本可能留下跨文件半成品，因此直接废弃工作区。 */
  public async run_script(script: string, signal: AbortSignal): Promise<JsonValue> {
    return await this.exclusive(async () => {
      const active = this.require_active();
      await this.assert_fresh(active);
      try {
        return (await this.options.run({ workspacePath: active.path, script }, signal)).result;
      } catch (error) {
        await this.reset_active();
        throw error;
      }
    });
  }

  /** 导入只信任 Backend 保存的 target 和快照，成功后销毁一次性工作区。 */
  public async import_workspace(): Promise<JsonRecord> {
    return await this.exclusive(async () => {
      const active = this.require_active();
      await this.assert_fresh(active);
      let result: JsonRecord;
      try {
        result =
          active.target === "items"
            ? await this.import_items(active)
            : await this.import_glossary(active);
      } catch (error) {
        if (!(error instanceof AppErrors.RequestValidationError)) await this.reset_active();
        throw error;
      }
      await this.reset_active();
      return result;
    });
  }

  /** reset、工程切换和 dispose 共用幂等清理。 */
  public async reset(): Promise<void> {
    await this.reset_active();
  }

  /** items target 保持行数、顺序和身份不变，只提取三个允许写入的字段差异。 */
  private async import_items(active: ActiveAgentWorkspace): Promise<JsonRecord> {
    const target_items = await read_jsonl_file(
      this.native_fs,
      path.join(active.path, "target/items.jsonl"),
    );
    const current_items = this.options.cache.items.readItems().map(project_agent_item);
    if (target_items.length !== current_items.length) {
      throw workspace_validation_error("agent_workspace_item_count_changed");
    }
    const changes: JsonRecord[] = [];
    for (const [index, current] of current_items.entries()) {
      const target = target_items[index];
      if (target === undefined) throw workspace_validation_error("agent_workspace_item_missing");
      assert_known_fields(target, WORKSPACE_ITEM_FIELDS, "agent_workspace_unknown_item_field");
      assert_workspace_item_identity(current, target);
      const dst = target["dst"];
      const name_dst = target["name_dst"];
      const status = target["status"];
      if (
        typeof dst !== "string" ||
        (name_dst !== undefined && typeof name_dst !== "string") ||
        !is_item_status(status)
      ) {
        throw workspace_validation_error("agent_workspace_invalid_item_write");
      }
      const change: JsonRecord = { item_id: current.item_id };
      if (dst !== current.dst) change["dst"] = dst;
      if (String(name_dst ?? "") !== String(current.name_dst ?? "")) {
        change["name_dst"] = String(name_dst ?? "");
      }
      if (status !== current.status) {
        if (!(PROOFREADING_MANUAL_STATUS_CODES as readonly string[]).includes(status)) {
          throw workspace_validation_error("agent_workspace_invalid_manual_status");
        }
        change["status"] = status;
      }
      if (Object.keys(change).length > 1) changes.push(change);
    }
    if (changes.length === 0) {
      return {
        status: "unchanged",
        target: "items",
        updated: 0,
        revisions: {
          items: read_json_integer(active.revisions.items, 0),
          proofreading: read_json_integer(active.revisions.proofreading, 0),
        },
      };
    }
    let write_result: ProjectWriteResult;
    try {
      write_result = await this.options.proofreading.commands.update_items_from_agent_workspace(
        {
          changes,
          expected_section_revisions: {
            items: read_json_integer(active.revisions.items, 0),
            proofreading: read_json_integer(active.revisions.proofreading, 0),
          },
        },
        "agent_workspace_import_items",
      );
    } catch (error) {
      await this.reset_active();
      throw error;
    }
    const committed = write_result.changes.at(-1);
    if (committed === undefined) {
      await this.reset_active();
      throw workspace_validation_error(
        "agent_workspace_item_write_not_confirmed",
        "workspace_export",
      );
    }
    return {
      status: "applied",
      target: "items",
      updated: changes.length,
      revisions: {
        items: read_json_integer(committed.sectionRevisions["items"], 0),
        proofreading: read_json_integer(committed.sectionRevisions["proofreading"], 0),
      },
    };
  }

  /** glossary target 是最终有序集合；既有 ID 不可伪造，新条目由 Backend 生成 ID。 */
  private async import_glossary(active: ActiveAgentWorkspace): Promise<JsonRecord> {
    const rows = await read_jsonl_file(
      this.native_fs,
      path.join(active.path, "target/glossary.jsonl"),
    );
    const current = read_quality_entries(this.options.cache.quality.readBlock(), "glossary");
    const current_ids = new Set(current.map((entry) => String(entry["entry_id"] ?? "")));
    const next_ids = new Set<string>();
    const next_raw = rows.map((row) => {
      assert_known_fields(row, WORKSPACE_GLOSSARY_FIELDS, "agent_workspace_unknown_glossary_field");
      const raw_id = row["id"];
      const entry_id =
        raw_id === undefined ? create_quality_rule_entry_id() : String(raw_id).trim();
      if ((raw_id !== undefined && !current_ids.has(entry_id)) || next_ids.has(entry_id)) {
        throw workspace_validation_error("agent_workspace_invalid_glossary_id");
      }
      next_ids.add(entry_id);
      return {
        entry_id,
        src: row["src"],
        dst: row["dst"],
        info: row["info"],
        case_sensitive: row["case_sensitive"],
      } as JsonRecord;
    });
    let next: JsonRecord[];
    try {
      next = normalize_quality_rule_entries(
        QualityRule.from_json("glossary"),
        next_raw,
      ) as JsonRecord[];
    } catch (cause) {
      throw new AppErrors.RequestValidationError({
        cause,
        diagnostic_context: { reason: "agent_workspace_invalid_glossary" },
      });
    }
    if (JsonTool.stringifyStrict(current) === JsonTool.stringifyStrict(next)) {
      return {
        status: "unchanged",
        target: "glossary",
        updated: 0,
        revisions: { quality: read_json_integer(active.revisions.quality, 0) },
      };
    }
    let write_result: ProjectWriteResult;
    try {
      write_result = await this.options.qualityRules.update_from_agent(
        {
          rule_type: "glossary",
          entries: next,
          expected_section_revisions: {
            quality: read_json_integer(active.revisions.quality, 0),
          },
        },
        "agent_workspace_import_glossary",
      );
    } catch (error) {
      await this.reset_active();
      throw error;
    }
    const committed = write_result.changes.at(-1);
    if (committed === undefined) {
      await this.reset_active();
      throw workspace_validation_error(
        "agent_workspace_glossary_write_not_confirmed",
        "workspace_export",
      );
    }
    const changed =
      next.filter((entry, index) => {
        return JsonTool.stringifyStrict(entry) !== JsonTool.stringifyStrict(current[index] ?? null);
      }).length + Math.max(0, current.length - next.length);
    return {
      status: "applied",
      target: "glossary",
      updated: changed,
      revisions: { quality: read_json_integer(committed.sectionRevisions["quality"], 0) },
    };
  }

  /** 任一工程身份、依赖 revision 或文本设置变化都会废弃整个旧快照。 */
  private async assert_fresh(active: ActiveAgentWorkspace): Promise<void> {
    const snapshot = this.options.cache.snapshot();
    const settings_key = JsonTool.stringifyStrict(
      read_workspace_settings(this.options.settings.read_setting()),
    );
    const fresh =
      snapshot.projectPath === active.projectPath &&
      snapshot.epoch === active.projectEpoch &&
      settings_key === active.settingsKey &&
      WORKSPACE_DEPENDENCY_SECTIONS.every(
        (section) =>
          read_json_integer(snapshot.sectionRevisions[section], 0) ===
          read_json_integer(active.revisions[section], 0),
      );
    if (fresh) return;
    await this.reset_active();
    throw workspace_validation_error("agent_workspace_stale", "workspace_export");
  }

  /** 所有非导出操作都必须显式依赖当前工作区。 */
  private require_active(): ActiveAgentWorkspace {
    if (this.active === null) {
      throw workspace_validation_error("agent_workspace_missing", "workspace_export");
    }
    return this.active;
  }

  /** 先清空内存身份再删目录，删除失败也不会让旧快照重新可用。 */
  private async reset_active(): Promise<void> {
    const active = this.active;
    this.active = null;
    if (active !== null) {
      await this.native_fs.remove_async(active.path, { recursive: true, force: true });
    }
  }

  /** 工作区工具必须串行，避免脚本、导入与新导出同时改写同一目录。 */
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

/** Agent 会话与工具只依赖工作区公开生命周期，不持有具体类的私有状态。 */
export type AgentWorkspacePort = Pick<
  AgentWorkspaceService,
  "initialize" | "export_workspace" | "run_script" | "import_workspace" | "reset"
>;

/** 只冻结会改变导入解释的设置，密钥、模型等其它配置不进入工作区。 */
function read_workspace_settings(value: unknown): JsonRecord {
  const settings = normalize_setting_snapshot(value);
  return {
    source_language: settings.source_language,
    target_language: settings.target_language,
    clean_ruby: settings.clean_ruby,
    auto_process_prefix_suffix_preserved_text: settings.auto_process_prefix_suffix_preserved_text,
  };
}

/** 导出和过期校验共享同一组依赖 revision。 */
function pick_workspace_revisions(
  revisions: ProjectDataSectionRevisions,
): ProjectDataSectionRevisions {
  return Object.fromEntries(
    WORKSPACE_DEPENDENCY_SECTIONS.map((section) => [
      section,
      read_json_integer(revisions[section], 0),
    ]),
  );
}

/** 质量规则先通过领域规范化，并要求每个导出条目已有稳定身份。 */
function read_quality_entries(
  quality: JsonRecord,
  kind: (typeof QUALITY_RULE_KINDS)[number],
): JsonRecord[] {
  const entries = read_json_record(quality[kind])["entries"];
  const normalized = normalize_quality_rule_entries(
    QualityRule.from_json(kind),
    entries,
  ) as JsonRecord[];
  for (const entry of normalized) {
    if (String(entry["entry_id"] ?? "").trim() === "") {
      throw workspace_validation_error(
        "agent_workspace_quality_entry_id_missing",
        "workspace_export",
      );
    }
  }
  return normalized;
}

/** 工作区用公开 id 替代内部 entry_id，其余规范化字段保持原值。 */
function project_workspace_quality_entry(entry: JsonRecord): JsonRecord {
  const projected = Object.fromEntries(
    Object.entries(entry).filter(([key]) => key !== "entry_id"),
  ) as JsonRecord;
  projected["id"] = String(entry["entry_id"] ?? "");
  return projected;
}

/** 规则正文进入各自 JSONL，汇总文件只保留执行模式。 */
function project_quality_settings(quality: JsonRecord): JsonRecord {
  return Object.fromEntries(
    QUALITY_RULE_KINDS.map((kind) => {
      const slice = read_json_record(quality[kind]);
      return [kind, { enabled: slice["enabled"] ?? false, mode: slice["mode"] ?? null }];
    }),
  );
}

/** items target 不得改写定位、原文或重试事实。 */
function assert_workspace_item_identity(current: JsonRecord, target: JsonRecord): void {
  const same =
    read_json_integer(target["item_id"], 0) === current["item_id"] &&
    String(target["src"] ?? "") === current["src"] &&
    String(target["name_src"] ?? "") === String(current["name_src"] ?? "") &&
    String(target["file_path"] ?? "") === current["file_path"] &&
    read_json_integer(target["row_number"], 0) === current["row_number"] &&
    read_json_integer(target["retry_count"], -1) === current["retry_count"];
  if (!same) throw workspace_validation_error("agent_workspace_item_identity_changed");
}

/** target 行拒绝任何未声明字段，避免建立领域写入口之外的旁路。 */
function assert_known_fields(value: JsonRecord, fields: readonly string[], reason: string): void {
  const unknown = Object.keys(value).find((field) => !fields.includes(field));
  if (unknown !== undefined) {
    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason, field: unknown },
    });
  }
}

/** 小型 manifest 与 context 对象使用严格、稳定的 JSON 文本。 */
async function write_json_file(
  native_fs: NativeFs,
  file_path: string,
  value: JsonRecord,
): Promise<void> {
  await native_fs.write_file(file_path, `${JsonTool.stringifyStrict(value, { indent: 2 })}\n`);
}

/** 大型集合逐行序列化到写流，不先拼接完整文件字符串。 */
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

/** 导入逐行校验严格 JSON object，并保留准确行号用于本地诊断。 */
async function read_jsonl_file(native_fs: NativeFs, file_path: string): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  const lines = readline.createInterface({
    input: native_fs.create_read_stream(file_path),
    crlfDelay: Infinity,
  });
  let line_number = 0;
  try {
    for await (const line of lines) {
      line_number += 1;
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JsonTool.parseStrict(line);
      } catch (cause) {
        throw new AppErrors.RequestValidationError({
          cause,
          diagnostic_context: { reason: "agent_workspace_invalid_jsonl", line: line_number },
        });
      }
      if (!is_json_record(parsed)) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "agent_workspace_jsonl_row_not_object", line: line_number },
        });
      }
      rows.push(parsed);
    }
  } finally {
    lines.close();
  }
  return rows;
}

/** 工作区校验错误只公开恢复动作，具体原因留给本地诊断。 */
function workspace_validation_error(
  reason: string,
  action: "workspace_export" | "workspace_run" = "workspace_run",
): AppErrors.RequestValidationError {
  return new AppErrors.RequestValidationError({
    public_details: { action },
    diagnostic_context: { reason },
  });
}
