import path from "node:path";

import { ProjectDatabase } from "../database/database-operations";
import type { JsonRecord, JsonValue } from "../../domain/json";
import type { CacheReadPort } from "../cache/cache-types";
import { AppPathService, resolve_preset_file } from "../app/app-path-service";
import { JsonTool } from "../../shared/utils/json-tool";
import { ProjectWriteStore } from "../project/project-write-store";
import { require_project_expected_section_revisions } from "../project/project-write-request";
import { ProjectSessionState } from "../project/project-session-state";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import type { ProjectDataSection, ProjectWriteResult } from "../../shared/project-event";
import {
  build_analysis_glossary_entry_from_candidate,
  count_analysis_glossary_candidates,
} from "../../shared/analysis-candidate";
import { QualityRule, type QualityRuleKind } from "../../domain/quality";
import { is_json_record, read_json_record } from "../../domain/json";
import * as AppErrors from "../../shared/error";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import {
  export_quality_rule_entries_to_files,
  load_quality_rule_entries_from_file,
} from "./quality-rule-file-io";
import {
  prepare_analysis_glossary_import_from_cache,
  to_analysis_glossary_import_prepare_payload,
} from "./quality-rule-analysis-glossary-import";
import { normalize_quality_rule_entries } from "../../shared/quality/quality-rule-entry";

const DEFAULT_QUALITY_RULE_UPDATE_SOURCE = "quality_rule_update";

/**
 * 封装质量规则 CRUD、分析术语导入、预设 IO 和 revision 对齐。
 */
export class QualityRuleService {
  private readonly paths: AppPathService; // 统一解析内置 / 用户预设目录，服务层不在调用点拼接路径

  private readonly database: ProjectDatabase; // 质量规则和提示词工程事实只通过 ProjectDatabase workflow 读写

  private readonly session_state: ProjectSessionState; // 页面级质量规则 / 提示词写入口以 会话状态作为当前工程目标

  private readonly write_store: ProjectWriteStore; // 工程质量 / 提示词事实统一交由 ProjectWriteStore 提交

  private readonly runtime_gate: RuntimeOperationGate; // 用户与 Agent 写入口共享串行门禁

  private readonly cache: CacheReadPort; // 查询与分析导入准备只读取当前 loaded 工程热事实

  private readonly native_fs: NativeFs; // 规则、提示词预设和导入导出的唯一文件 IO 入口

  /**
   * 初始化质量规则依赖，保持外部写入口清晰。
   */
  public constructor(
    paths: AppPathService,
    database: ProjectDatabase,
    session_state: ProjectSessionState,
    write_store: ProjectWriteStore,
    runtime_gate: RuntimeOperationGate,
    cache: CacheReadPort,
    native_fs: NativeFs = default_native_fs,
  ) {
    this.paths = paths;
    this.database = database;
    this.session_state = session_state;
    this.write_store = write_store;
    this.runtime_gate = runtime_gate;
    this.cache = cache;
    this.native_fs = native_fs;
  }

  /**
   * 读取单个质量规则切片。
   */
  public query(request: JsonRecord): JsonRecord {
    const project_path = this.session_state.require_loaded_project_path();
    const rule_type = this.normalize_rule_type(request["rule_type"]);
    const quality_block = this.cache.quality.readBlock();
    return {
      projectPath: project_path,
      sectionRevisions: this.cache.readSectionRevisions() as unknown as JsonValue,
      qualityRule: this.normalize_record(quality_block[rule_type]) as unknown as JsonValue,
    };
  }

  /**
   * 从后端候选、规则和 item 快照生成可提交的分析术语导入计划。
   */
  public prepare_analysis_glossary_import(request: JsonRecord): JsonRecord {
    const project_path = this.session_state.require_loaded_project_path();
    const section_revisions = this.cache.readSectionRevisions();
    const prepared_import = prepare_analysis_glossary_import_from_cache({
      quality_block: this.cache.quality.readBlock(),
      items: this.cache.items.readItems(),
      section_revisions,
      candidate_aggregate: read_json_record(request["candidate_aggregate"]),
      action: this.read_analysis_glossary_import_action(request["action"]),
    });
    return {
      projectPath: project_path,
      sectionRevisions: section_revisions as unknown as JsonValue,
      prepared_import: to_analysis_glossary_import_prepare_payload(prepared_import),
    };
  }

  /**
   * 提交分析术语导入，同时推进真实发生变化的 quality / analysis revision。
   */
  public async import_analysis_glossary(request: JsonRecord): Promise<ProjectWriteResult> {
    return await this.runtime_gate.run_project_write(async () => {
      const project_path = this.session_state.require_loaded_project_path();
      this.assert_no_legacy_fields(request, [
        "analysis_candidate_count",
        "expected_glossary_revision",
      ]);
      const next_rules = this.normalize_rule_entries("glossary", request["entries"]);
      const current_rules = this.normalize_rule_entries(
        "glossary",
        this.database.get_rules(project_path, QualityRule.from_json("glossary").database_type),
      );
      const quality_changed = !this.are_rule_entries_equal(current_rules, next_rules);
      const updated_sections: ProjectDataSection[] = quality_changed
        ? ["quality", "analysis"]
        : ["analysis"];
      const consumed_candidate_srcs = this.normalize_string_list(
        request["consumed_candidate_srcs"],
      );
      return await this.write_store.import_analysis_glossary({
        projectPath: project_path,
        expectedSectionRevisions: require_project_expected_section_revisions(
          request["expected_section_revisions"],
        ),
        qualityRule: quality_changed
          ? {
              databaseType: QualityRule.from_json("glossary").database_type,
              entries: next_rules,
              revisionKey: QualityRule.from_json("glossary").revision_meta_key,
            }
          : null,
        consumedCandidateSrcs: consumed_candidate_srcs,
        analysisCandidateCount: this.count_remaining_analysis_candidates(
          project_path,
          consumed_candidate_srcs,
        ),
        updatedSections: updated_sections,
      });
    });
  }

  /**
   * 原子更新规则条目与 meta；entries 缺失表示不改条目，空数组表示清空条目。
   */
  public async update(request: JsonRecord): Promise<ProjectWriteResult> {
    return await this.runtime_gate.run_project_write(
      async () => await this.update_under_lease(request, DEFAULT_QUALITY_RULE_UPDATE_SOURCE),
    );
  }

  /** Agent 工具只能在自己的运行 lease 内复用同一规则提交实现。 */
  public async update_from_agent(request: JsonRecord, source: string): Promise<ProjectWriteResult> {
    return await this.runtime_gate.run_agent_project_write(
      async () => await this.update_under_lease(request, source),
    );
  }

  /** 用户与 Agent 两条门禁入口在取得 lease 后共享同一规范化和事务提交。 */
  private async update_under_lease(
    request: JsonRecord,
    source: string,
  ): Promise<ProjectWriteResult> {
    this.assert_no_legacy_fields(request, ["expected_revision"]);
    const rule_type = this.normalize_rule_type(request["rule_type"]);
    const project_path = this.session_state.require_loaded_project_path();
    const has_entries = Object.prototype.hasOwnProperty.call(request, "entries");
    const entries = has_entries
      ? this.normalize_rule_entries(rule_type, request["entries"])
      : undefined;
    const meta = { ...read_json_record(request["meta"]) };
    if (!has_entries && Object.keys(meta).length === 0) {
      throw new AppErrors.RequestValidationError({
        diagnostic_context: { reason: "empty_quality_rule_update" },
      });
    }
    const meta_entries: JsonRecord = {};
    for (const [key, value] of Object.entries(meta)) {
      const meta_key = this.resolve_rule_meta_key(rule_type, key);
      const meta_value = this.normalize_rule_meta_value(rule_type, key, value);
      meta_entries[meta_key] = meta_value;
    }
    return await this.write_store.save_quality_rules({
      projectPath: project_path,
      expectedSectionRevisions: require_project_expected_section_revisions(
        request["expected_section_revisions"],
      ),
      source,
      rule:
        entries === undefined
          ? undefined
          : {
              databaseType: QualityRule.from_json(rule_type).database_type,
              entries,
            },
      metaEntries: meta_entries,
      revisionKey: this.build_rule_revision_key(rule_type),
    });
  }

  /**
   * 从外部文件导入规则预演结果，保持导入解析在服务内收口
   */
  public async import_rules(request: JsonRecord): Promise<JsonRecord> {
    const rule_type = this.normalize_rule_type(request["rule_type"]);
    const file_path = String(request["path"] ?? "");
    const entries = this.normalize_rule_entries(
      rule_type,
      (await this.load_rules_from_file(file_path)) as unknown as JsonValue,
    );
    return { entries: entries as unknown as JsonValue };
  }

  /**
   * 导出规则到用户选择路径，避免页面处理文件格式细节
   */
  public async export_rules(request: JsonRecord): Promise<JsonRecord> {
    const file_path = String(request["path"] ?? "");
    const rule_type = this.normalize_rule_type(request["rule_type"]);
    const entries = this.normalize_rule_entries(rule_type, request["entries"]);
    const base_path = this.without_extension(file_path);
    await this.export_rules_to_files(base_path, entries);
    return { path: `${base_path}.json`.replace(/\\/g, "/") };
  }

  /**
   * CLI 分析导出直接从当前工程候选池生成 glossary.json 与 glossary.xlsx。
   */
  public async export_analysis_candidates_to_directory(output_dir: string): Promise<JsonRecord> {
    const project_path = this.session_state.require_loaded_project_path();
    const output_base_path = path.join(path.resolve(output_dir), "glossary");
    this.native_fs.make_dir(path.dirname(output_base_path));
    const entries = this.build_glossary_entries_from_candidates(
      this.read_analysis_candidate_aggregates(project_path),
    );
    await this.export_rules_to_files(output_base_path, entries);
    return {
      json_path: `${output_base_path}.json`.replace(/\\/g, "/"),
      xlsx_path: `${output_base_path}.xlsx`.replace(/\\/g, "/"),
      entry_count: entries.length,
    };
  }

  /**
   * 列出内置和用户规则预设，统一虚拟 id 语义
   */
  public list_rule_presets(request: JsonRecord): JsonRecord {
    const preset_directory = QualityRule.from_json(request["rule_type"]).preset_directory;
    return {
      builtin_presets: this.list_preset_items(
        "builtin",
        this.paths.get_quality_rule_builtin_preset_dir(preset_directory),
        this.paths.get_quality_rule_builtin_preset_relative_dir(preset_directory),
        ".json",
      ) as unknown as JsonValue,
      user_presets: this.list_preset_items(
        "user",
        this.paths.get_quality_rule_user_preset_dir(preset_directory),
        undefined,
        ".json",
      ) as unknown as JsonValue,
    };
  }

  /**
   * 读取规则预设内容，隐藏内置和用户目录差异
   */
  public read_rule_preset(request: JsonRecord): JsonRecord {
    const rule_type = this.normalize_rule_type(request["rule_type"]);
    const preset_directory = QualityRule.from_json(rule_type).preset_directory;
    const preset_path = this.resolve_rule_preset_file(
      preset_directory,
      String(request["virtual_id"] ?? ""),
    ).file_path;
    const data = JsonTool.parseStrict(this.native_fs.read_file(preset_path)) as unknown;
    if (!Array.isArray(data)) {
      throw new AppErrors.RequestValidationError({
        public_details: {
          filename: path.basename(preset_path),
        },
      });
    }
    return {
      entries: this.normalize_rule_entries(rule_type, data as JsonValue) as unknown as JsonValue,
    };
  }

  /**
   * 保存用户规则预设，确保文件名和目录规则一致
   */
  public save_rule_preset(request: JsonRecord): JsonRecord {
    const preset_directory = QualityRule.from_json(request["rule_type"]).preset_directory;
    const name = this.normalize_preset_name(String(request["name"] ?? ""));
    const rule_type = this.normalize_rule_type(request["rule_type"]);
    const entries = this.normalize_rule_entries(rule_type, request["entries"]);
    const directory = this.paths.get_quality_rule_user_preset_dir(preset_directory);
    this.native_fs.make_dir(directory);
    const preset_file = resolve_preset_file({
      virtual_id: `user:${name}.json`,
      extension: ".json",
      builtin_directory: directory,
      user_directory: directory,
    });
    this.native_fs.write_file_sync(
      preset_file.file_path,
      JsonTool.stringifyStrict(entries, { indent: 4 }),
    );
    return {
      item: this.build_preset_item("user", preset_file.file_name, directory, ".json"),
    };
  }

  /**
   * 重命名用户规则预设，保护内置预设不可变边界
   */
  public rename_rule_preset(request: JsonRecord): JsonRecord {
    const preset_directory = QualityRule.from_json(request["rule_type"]).preset_directory;
    const current_file = this.resolve_rule_preset_file(
      preset_directory,
      String(request["virtual_id"] ?? ""),
    );
    if (current_file.source !== "user") {
      throw new AppErrors.RequestValidationError();
    }
    const directory = this.paths.get_quality_rule_user_preset_dir(preset_directory);
    const new_file = resolve_preset_file({
      virtual_id: `user:${this.normalize_preset_name(String(request["new_name"] ?? ""))}.json`,
      extension: ".json",
      builtin_directory: directory,
      user_directory: directory,
    });
    this.native_fs.rename(current_file.file_path, new_file.file_path);
    return {
      item: this.build_preset_item("user", new_file.file_name, directory, ".json"),
    };
  }

  /**
   * 删除用户规则预设，避免调用方误删内置资源
   */
  public delete_rule_preset(request: JsonRecord): JsonRecord {
    const preset_directory = QualityRule.from_json(request["rule_type"]).preset_directory;
    const preset_file = this.resolve_rule_preset_file(
      preset_directory,
      String(request["virtual_id"] ?? ""),
    );
    if (preset_file.source !== "user") {
      throw new AppErrors.RequestValidationError();
    }
    this.native_fs.remove(preset_file.file_path);
    return { path: preset_file.file_path.replace(/\\/g, "/") };
  }

  /**
   * 生成规则 revision key，避免调用方拼接 meta 名称
   */
  private build_rule_revision_key(rule_type: QualityRuleKind): string {
    return QualityRule.from_json(rule_type).revision_meta_key;
  }

  /**
   * 规则 meta key 由领域对象解析，避免服务层保留旧字符串映射表
   */
  private resolve_rule_meta_key(rule_type: QualityRuleKind, key: string): string {
    return QualityRule.from_json(rule_type).resolve_meta_key(key);
  }

  /**
   * 归一规则 meta 值，兼容旧项目缺失字段
   */
  private normalize_rule_meta_value(
    rule_type: QualityRuleKind,
    key: string,
    value: JsonValue,
  ): JsonValue {
    return QualityRule.from_json(rule_type).normalize_meta_value(key, value) as JsonValue;
  }

  /**
   * 旧单 revision 字段不再作为兼容层进入服务边界
   */
  private assert_no_legacy_fields(request: JsonRecord, fields: string[]): void {
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(request, field)) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "legacy_quality_write_field", field },
        });
      }
    }
  }

  /**
   * 归一规则类型，保护质量规则接口只接受已知分组
   */
  private normalize_rule_type(value: JsonValue | undefined): QualityRuleKind {
    return QualityRule.from_json(value).kind;
  }

  /**
   * 归一规则条目列表，确保写入数据库前字段完整
   */
  private normalize_rule_entries(
    rule_type: QualityRuleKind,
    value: JsonValue | undefined,
  ): JsonRecord[] {
    try {
      return normalize_quality_rule_entries(
        QualityRule.from_json(rule_type),
        value,
      ) as JsonRecord[];
    } catch (cause) {
      throw new AppErrors.RequestValidationError({ cause });
    }
  }

  /**
   * 归一单条规则，兼容导入和页面编辑两种来源
   */
  private normalize_rule_entry(rule_type: QualityRuleKind, entry: JsonRecord): JsonRecord {
    try {
      return QualityRule.from_json(rule_type).normalize_entry(entry) as JsonRecord;
    } catch (cause) {
      throw new AppErrors.RequestValidationError({ cause });
    }
  }

  /**
   * 缺失规则切片按空记录返回，由页面使用领域默认值补齐。
   */
  private normalize_record(value: unknown): JsonRecord {
    return is_json_record(value) ? (value as JsonRecord) : {};
  }

  /**
   * 分析术语导入只接受 skip / overwrite。
   */
  private read_analysis_glossary_import_action(value: JsonValue | undefined): "skip" | "overwrite" {
    if (value === undefined || value === null || value === "overwrite") {
      return "overwrite";
    }
    if (value === "skip") {
      return "skip";
    }
    throw new AppErrors.RequestValidationError({
      diagnostic_context: { reason: "invalid_analysis_glossary_import_action" },
    });
  }

  /**
   * 路径与候选主键列表只保留非空字符串。
   */
  private normalize_string_list(value: JsonValue | undefined): string[] {
    return Array.isArray(value)
      ? value.map((entry) => String(entry).trim()).filter((entry) => entry !== "")
      : [];
  }

  /**
   * 规则条目按规范化完整形状比较，只有真实变化才推进 quality revision。
   */
  private are_rule_entries_equal(left_entries: JsonRecord[], right_entries: JsonRecord[]): boolean {
    return JSON.stringify(left_entries) === JSON.stringify(right_entries);
  }

  /**
   * 候选数只根据当前数据库聚合与本次消费主键计算。
   */
  private count_remaining_analysis_candidates(
    project_path: string,
    consumed_candidate_srcs: string[],
  ): number {
    const consumed = new Set(consumed_candidate_srcs);
    return count_analysis_glossary_candidates(
      this.read_analysis_candidate_aggregates(project_path).filter(
        (row) => !consumed.has(String(row["src"] ?? "").trim()),
      ),
    );
  }

  /**
   * 按扩展名读取规则文件，保持导入格式分发集中
   */
  private async load_rules_from_file(file_path: string): Promise<unknown[]> {
    return load_quality_rule_entries_from_file(file_path, this.native_fs);
  }

  /**
   * 读取分析候选聚合行，保持 CLI 导出不直接拼 SQL。
   */
  private read_analysis_candidate_aggregates(project_path: string): JsonRecord[] {
    const value = this.database.get_analysis_candidate_aggregates(project_path);
    return Array.isArray(value)
      ? value
          .filter((entry): entry is JsonRecord => is_json_record(entry))
          .map((entry) => ({
            ...entry,
          }))
      : [];
  }

  /**
   * 从候选投票池生成可导出的术语条目，沿用共享候选术语口径。
   */
  private build_glossary_entries_from_candidates(candidates: JsonRecord[]): JsonRecord[] {
    const entries: JsonRecord[] = [];
    for (const candidate of candidates) {
      const entry = build_analysis_glossary_entry_from_candidate(candidate);
      if (entry === null) {
        continue;
      }
      entries.push(this.normalize_rule_entry("glossary", entry as unknown as JsonRecord));
    }
    return entries;
  }

  /**
   * 按目标扩展名导出规则，隐藏 JSON 与表格写出差异
   */
  private async export_rules_to_files(base_path: string, entries: JsonRecord[]): Promise<void> {
    await export_quality_rule_entries_to_files(base_path, entries, this.native_fs);
  }

  /**
   * 遍历预设目录，生成 UI 可消费的稳定列表
   */
  private list_preset_items(
    source: "builtin" | "user",
    directory: string,
    resolved_path_dir: string | undefined,
    extension: ".json" | ".txt",
  ): JsonRecord[] {
    if (source === "user") {
      this.native_fs.make_dir(directory);
    } else if (!this.native_fs.exists(directory)) {
      return [];
    }
    const path_dir = resolved_path_dir ?? directory;
    return this.native_fs
      .read_dir_names(directory)
      .filter((file_name) => file_name.toLowerCase().endsWith(extension))
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
      .map((file_name) => this.build_preset_item(source, file_name, path_dir, extension));
  }

  /**
   * 构造预设列表项，集中维护虚拟 id 和显示名
   */
  private build_preset_item(
    source: "builtin" | "user",
    file_name: string,
    path_dir: string,
    extension: ".json" | ".txt",
  ): JsonRecord {
    const preset_file = resolve_preset_file({
      virtual_id: `${source}:${file_name}`,
      extension,
      builtin_directory: path_dir,
      user_directory: path_dir,
    });
    return {
      name: file_name.slice(0, -extension.length),
      file_name,
      virtual_id: `${source}:${file_name}`,
      path: preset_file.file_path.replace(/\\/g, "/"),
      type: source,
    };
  }

  /**
   * 解析规则预设路径，保护内置与用户预设边界
   */
  private resolve_rule_preset_file(
    preset_directory: string,
    virtual_id: string,
  ): ReturnType<typeof resolve_preset_file> {
    return resolve_preset_file({
      virtual_id,
      extension: ".json",
      builtin_directory: this.paths.get_quality_rule_builtin_preset_dir(preset_directory),
      user_directory: this.paths.get_quality_rule_user_preset_dir(preset_directory),
      allow_legacy_namespace: true,
    });
  }

  /**
   * 归一预设显示名，保持文件名和 UI 文案一致
   */
  private normalize_preset_name(name: string): string {
    const normalized_name = name.trim();
    if (normalized_name === "") {
      throw new AppErrors.RequestValidationError();
    }
    return normalized_name;
  }

  /**
   * 移除文件扩展名，保持预设显示名生成一致
   */
  private without_extension(file_path: string): string {
    const parsed = path.parse(file_path);
    return path.join(parsed.dir, parsed.name);
  }
}
