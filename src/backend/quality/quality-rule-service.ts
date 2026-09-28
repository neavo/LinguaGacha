import { randomUUID } from "node:crypto";
import type { AppSettingService } from "../app/app-setting-service";
import type {
  QualityRuleQueryResponse,
  QualityRuleEntriesResponse,
  QualityRuleExportResponse,
  QualityRulePresetSaveResponse,
  QualityRulePresets,
  QualityRulePresetItem,
  QualityRulePresetChange,
} from "../../shared/quality/quality-rule-api";
import path from "node:path";

import type { JsonRecord, JsonValue } from "../../domain/json";
import type { CacheReadPort } from "../cache/cache-types";
import { AppPathService, resolve_preset_file } from "../app/app-path-service";
import { JsonTool } from "../../shared/utils/json-tool";
import { ProjectWriteStore } from "../project/project-write-store";
import { require_project_expected_section_revisions } from "../project/project-write-request";
import { ProjectSessionState } from "../project/project-session-state";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import type { ProjectWriteResult } from "../../shared/project-event";

import { QualityRule, type QualityRuleKind, type QualityRuleEntry } from "../../domain/quality";
import { read_json_record } from "../../domain/json";
import * as AppErrors from "../../shared/error";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import {
  export_quality_rule_entries_to_files,
  load_quality_rule_entries_from_file,
} from "./quality-rule-file-io";

import {
  create_quality_rule_entries,
  normalize_quality_rule_entries,
} from "../../shared/quality/quality-rule-entry";

const DEFAULT_QUALITY_RULE_UPDATE_SOURCE = "quality_rule_update";

/**
 * 封装质量规则 CRUD、预设 IO 和 revision 对齐。
 */
export class QualityRuleService {
  /** 注入共享状态拥有者，预设文件与默认设置在同一命令内协调。 */
  public constructor(
    private readonly paths: AppPathService, // 预设目录和路径身份
    private readonly settings: AppSettingService, // 默认预设引用的唯一持久化入口
    private readonly session_state: ProjectSessionState, // 当前工程身份
    private readonly write_store: ProjectWriteStore, // 工程事实提交
    private readonly runtime_gate: RuntimeOperationGate, // 用户与 Agent 共用写入互斥
    private readonly cache: CacheReadPort, // 工程规则热读快照
    private readonly native_fs: NativeFs = default_native_fs, // 预设与导入导出的磁盘操作
  ) {}

  /**
   * 读取单个质量规则切片。
   */
  public query(request: JsonRecord): QualityRuleQueryResponse {
    const project_path = this.session_state.require_loaded_project_path();
    const rule_type = QualityRule.from_json(request["rule_type"]).kind;
    const quality_block = this.cache.quality.readBlock();
    return {
      projectPath: project_path,
      sectionRevisions: this.cache.readSectionRevisions(),
      qualityRule: quality_block[rule_type],
    };
  }

  /**
   * 原子更新规则条目与 meta；entries 缺失表示不改条目，空数组表示清空条目。
   */
  public async update(request: JsonRecord): Promise<ProjectWriteResult> {
    return await this.runtime_gate.run_project_write(
      async () => await this.update_under_lease(request),
    );
  }

  /** 取得用户项目写 lease 后统一规范化并提交规则事实。 */
  private async update_under_lease(request: JsonRecord): Promise<ProjectWriteResult> {
    this.assert_no_legacy_fields(request, ["expected_revision"]);
    const rule_type = QualityRule.from_json(request["rule_type"]).kind;
    const project_path = this.session_state.require_loaded_project_path();
    const has_entries = Object.hasOwn(request, "entries");
    const entries = has_entries
      ? this.normalize_rule_entries(rule_type, request["entries"])
      : undefined;
    const meta = { ...read_json_record(request["meta"]) };
    if (!has_entries && Object.keys(meta).length === 0) {
      throw new AppErrors.AppError("request.validation_failed", {
        diagnostic_context: { reason: "empty_quality_rule_update" },
      });
    }
    const rule = QualityRule.from_json(rule_type);
    const meta_entries: JsonRecord = {};
    for (const [key, value] of Object.entries(meta)) {
      const meta_key = rule.resolve_meta_key(key);
      const meta_value = rule.normalize_meta_value(key, value) as JsonValue;
      meta_entries[meta_key] = meta_value;
    }
    return await this.write_store.save_quality_rules({
      projectPath: project_path,
      expectedSectionRevisions: require_project_expected_section_revisions(
        request["expected_section_revisions"],
      ),
      source: DEFAULT_QUALITY_RULE_UPDATE_SOURCE,
      rule:
        entries === undefined
          ? undefined
          : {
              databaseType: rule.database_type,
              entries,
            },
      metaEntries: meta_entries,
      revisionKey: rule.revision_meta_key,
    });
  }

  /**
   * 从外部文件导入规则预演结果，保持导入解析在服务内收口
   */
  public async import_rules(request: JsonRecord): Promise<QualityRuleEntriesResponse> {
    const rule_type = QualityRule.from_json(request["rule_type"]).kind;
    const file_path = String(request["path"] ?? "");
    const entries = this.create_rule_entries(
      rule_type,
      await load_quality_rule_entries_from_file(file_path, this.native_fs),
    );
    return { entries };
  }

  /**
   * 导出规则到用户选择路径，避免页面处理文件格式细节
   */
  public async export_rules(request: JsonRecord): Promise<QualityRuleExportResponse> {
    const file_path = String(request["path"] ?? "");
    const rule_type = QualityRule.from_json(request["rule_type"]).kind;
    const entries = this.normalize_rule_entries(rule_type, request["entries"]);
    const base_path = this.without_extension(file_path);
    await export_quality_rule_entries_to_files(base_path, entries, this.native_fs);
    return { path: `${base_path}.json`.replace(/\\/g, "/") };
  }

  /**
   * 列出内置和用户规则预设，统一虚拟 id 语义
   */
  public list_rule_presets(request: JsonRecord): QualityRulePresets {
    const preset_directory = QualityRule.from_json(request["rule_type"]).preset_directory;
    return {
      builtin_presets: this.list_preset_items(
        "builtin",
        this.paths.get_quality_rule_builtin_preset_dir(preset_directory),
        this.paths.get_quality_rule_builtin_preset_relative_dir(preset_directory),
        ".json",
      ),
      user_presets: this.list_preset_items(
        "user",
        this.paths.get_quality_rule_user_preset_dir(preset_directory),
        undefined,
        ".json",
      ),
    };
  }

  /**
   * 读取规则预设内容，隐藏内置和用户目录差异
   */
  public read_rule_preset(request: JsonRecord): QualityRuleEntriesResponse {
    const rule_type = QualityRule.from_json(request["rule_type"]).kind;
    const preset_directory = QualityRule.from_json(rule_type).preset_directory;
    const preset_path = this.resolve_rule_preset_file(
      preset_directory,
      String(request["virtual_id"] ?? ""),
    ).file_path;
    const data = JsonTool.parseStrict(this.native_fs.read_file(preset_path)) as unknown;
    if (!Array.isArray(data)) {
      throw new AppErrors.AppError("request.validation_failed", {
        public_details: {
          filename: path.basename(preset_path),
        },
      });
    }
    return {
      entries: this.create_rule_entries(rule_type, data),
    };
  }

  /**
   * 保存用户规则预设，确保文件名和目录规则一致
   */
  public save_rule_preset(request: JsonRecord): QualityRulePresetSaveResponse {
    const preset_directory = QualityRule.from_json(request["rule_type"]).preset_directory;
    const name = this.normalize_preset_name(String(request["name"] ?? ""));
    const rule_type = QualityRule.from_json(request["rule_type"]).kind;
    const entries = this.normalize_rule_entries(rule_type, request["entries"]);
    const directory = this.paths.get_quality_rule_user_preset_dir(preset_directory);
    this.native_fs.make_dir(directory);
    const preset_file = resolve_preset_file({
      virtual_id: `user:${name}.json`,
      extension: ".json",
      builtin_directory: directory,
      user_directory: directory,
    });
    const preset_entries = entries.map((entry) => {
      const { entry_id: _entry_id, ...fields } = entry;
      return fields;
    });
    this.native_fs.write_file_sync(
      preset_file.file_path,
      JsonTool.stringifyStrict(preset_entries, { indent: 4 }),
    );
    return {
      item: this.build_preset_item("user", preset_file.file_name, directory, ".json"),
    };
  }

  /**
   * 重命名用户规则预设，保护内置预设不可变边界
   */
  public rename_rule_preset(request: JsonRecord): QualityRulePresetChange {
    const rule = QualityRule.from_json(request["rule_type"]);
    const id = String(request["virtual_id"] ?? "");
    const current = this.resolve_rule_preset_file(rule.preset_directory, id);
    if (current.source !== "user") throw new AppErrors.AppError("request.validation_failed");
    const directory = this.paths.get_quality_rule_user_preset_dir(rule.preset_directory);
    const next_id = `user:${this.normalize_preset_name(String(request["new_name"] ?? ""))}.json`;
    const next = resolve_preset_file({
      virtual_id: next_id,
      extension: ".json",
      builtin_directory: directory,
      user_directory: directory,
    });
    if (id === next_id) return this.preset_change_snapshot(rule.kind);
    if (
      this.native_fs.exists(next.file_path) &&
      this.native_fs.to_identity_path(current.file_path) !==
        this.native_fs.to_identity_path(next.file_path)
    )
      throw new AppErrors.AppError("request.validation_failed");
    const key = rule.default_preset_setting_key;
    const is_default = this.settings.read_setting()[key] === id;
    this.native_fs.rename(current.file_path, next.file_path);
    try {
      if (is_default) this.settings.update_app_settings({ [key]: next_id }, false);
    } catch (error) {
      try {
        this.native_fs.rename(next.file_path, current.file_path);
      } catch (rollback_error) {
        throw new AggregateError(
          [error, rollback_error],
          "Failed to restore renamed quality preset.",
        );
      }
      throw error;
    }
    if (is_default) this.publish_preset_settings(key);
    return this.preset_change_snapshot(rule.kind);
  }

  /** 先暂存文件，再同步清除默认引用；设置失败恢复原文件，已提交后的清理失败保留提交事实。 */
  public async delete_rule_preset(request: JsonRecord): Promise<QualityRulePresetChange> {
    const rule = QualityRule.from_json(request["rule_type"]);
    const id = String(request["virtual_id"] ?? "");
    const file = this.resolve_rule_preset_file(rule.preset_directory, id);
    if (file.source !== "user") throw new AppErrors.AppError("request.validation_failed");
    const staged = `${file.file_path}.pending-delete-${randomUUID()}`;
    const key = rule.default_preset_setting_key;
    const is_default = this.settings.read_setting()[key] === id;
    this.native_fs.rename(file.file_path, staged);
    try {
      if (is_default) this.settings.update_app_settings({ [key]: "" }, false);
    } catch (error) {
      try {
        this.native_fs.rename(staged, file.file_path);
      } catch (rollback_error) {
        throw new AggregateError(
          [error, rollback_error],
          "Failed to restore deleted quality preset.",
        );
      }
      throw error;
    }
    // 到这里预设和默认引用已提交；清理错误不能覆盖期间用户更新的设置或同名新预设。
    try {
      await this.native_fs.remove_async(staged);
    } catch (cause) {
      if (is_default) this.publish_preset_settings(key, cause);
      throw new AppErrors.AppError("data.committed_sync_failed", {
        cause,
        public_details: { committed: true },
      });
    }
    if (is_default) this.publish_preset_settings(key);
    return this.preset_change_snapshot(rule.kind);
  }

  /** 从已提交事实组装预设列表与设置，供前端同步消费。 */
  private preset_change_snapshot(kind: QualityRuleKind): QualityRulePresetChange {
    return {
      ...this.list_rule_presets({ rule_type: kind }),
      settings: this.settings.build_setting_snapshot(this.settings.read_setting()),
    };
  }

  /** 文件与配置完成后才发布；通知失败保留已提交语义。 */
  private publish_preset_settings(key: string, previous_failure?: unknown): void {
    try {
      this.settings.publish_settings_changed([key]);
    } catch (cause) {
      throw new AppErrors.AppError("data.committed_sync_failed", {
        cause:
          previous_failure === undefined
            ? cause
            : new AggregateError(
                [previous_failure, cause],
                "Preset cleanup and notification failed.",
              ),
        public_details: { committed: true },
      });
    }
  }

  /**
   * 旧单 revision 字段不再作为兼容层进入服务边界
   */
  private assert_no_legacy_fields(request: JsonRecord, fields: string[]): void {
    for (const field of fields) {
      if (Object.hasOwn(request, field)) {
        throw new AppErrors.AppError("request.validation_failed", {
          diagnostic_context: { reason: "legacy_quality_write_field", field },
        });
      }
    }
  }

  /**
   * 归一规则条目列表，确保写入数据库前字段完整
   */
  private normalize_rule_entries(rule_type: QualityRuleKind, value: unknown): QualityRuleEntry[] {
    try {
      return normalize_quality_rule_entries(QualityRule.from_json(rule_type), value);
    } catch (cause) {
      throw new AppErrors.AppError("request.validation_failed", { cause });
    }
  }

  /** 外部文件和预设不复用项目身份，并避开当前 kind 的全部既有身份。 */
  private create_rule_entries(rule_type: QualityRuleKind, value: unknown): QualityRuleEntry[] {
    try {
      const rule = QualityRule.from_json(rule_type);
      const current_entries = this.cache.quality.readBlock()[rule_type].entries;
      return create_quality_rule_entries(
        rule,
        value,
        current_entries.map((entry) => entry.entry_id),
      );
    } catch (cause) {
      throw new AppErrors.AppError("request.validation_failed", { cause });
    }
  }

  /**
   * 遍历预设目录，生成 UI 可消费的稳定列表
   */
  private list_preset_items(
    source: "builtin" | "user",
    directory: string,
    resolved_path_dir: string | undefined,
    extension: ".json" | ".txt",
  ): QualityRulePresetItem[] {
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
  ): QualityRulePresetItem {
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
      throw new AppErrors.AppError("request.validation_failed");
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
