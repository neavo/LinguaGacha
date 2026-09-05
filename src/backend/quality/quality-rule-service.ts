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

import { QualityRule, type QualityRuleKind } from "../../domain/quality";
import { is_json_record, read_json_record } from "../../domain/json";
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
  private readonly paths: AppPathService; // 质量规则预设目录与虚拟路径的解析入口

  private readonly session_state: ProjectSessionState; // 页面级质量规则 / 提示词写入口以 会话状态作为当前工程目标

  private readonly write_store: ProjectWriteStore; // 工程质量 / 提示词事实统一交由 ProjectWriteStore 提交

  private readonly runtime_gate: RuntimeOperationGate; // 用户与 Agent 写入口共享串行门禁

  private readonly cache: CacheReadPort; // 查询只读取当前 loaded 工程热事实

  private readonly native_fs: NativeFs; // 规则、提示词预设和导入导出的唯一文件 IO 入口

  /**
   * 初始化质量规则依赖，保持外部写入口清晰。
   */
  public constructor(
    paths: AppPathService,
    session_state: ProjectSessionState,
    write_store: ProjectWriteStore,
    runtime_gate: RuntimeOperationGate,
    cache: CacheReadPort,
    native_fs: NativeFs = default_native_fs,
  ) {
    this.paths = paths;

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
    const rule_type = this.normalize_rule_type(request["rule_type"]);
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
      source: DEFAULT_QUALITY_RULE_UPDATE_SOURCE,
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
    const entries = this.create_rule_entries(
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
      throw new AppErrors.AppError("request.validation_failed", {
        public_details: {
          filename: path.basename(preset_path),
        },
      });
    }
    return {
      entries: this.create_rule_entries(rule_type, data as JsonValue) as unknown as JsonValue,
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
    const preset_entries = entries.map((entry) => {
      const result = { ...entry };
      delete result["entry_id"];
      return result;
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
  public rename_rule_preset(request: JsonRecord): JsonRecord {
    const preset_directory = QualityRule.from_json(request["rule_type"]).preset_directory;
    const current_file = this.resolve_rule_preset_file(
      preset_directory,
      String(request["virtual_id"] ?? ""),
    );
    if (current_file.source !== "user") {
      throw new AppErrors.AppError("request.validation_failed");
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
      throw new AppErrors.AppError("request.validation_failed");
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
      if (Object.hasOwn(request, field)) {
        throw new AppErrors.AppError("request.validation_failed", {
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
      throw new AppErrors.AppError("request.validation_failed", { cause });
    }
  }

  /** 外部文件和预设不复用项目身份，并避开当前 kind 的全部既有身份。 */
  private create_rule_entries(
    rule_type: QualityRuleKind,
    value: JsonValue | undefined,
  ): JsonRecord[] {
    try {
      const rule = QualityRule.from_json(rule_type);
      const current_slice = this.normalize_record(this.cache.quality.readBlock()[rule_type]);
      const current_entries = normalize_quality_rule_entries(rule, current_slice["entries"] ?? []);
      return create_quality_rule_entries(
        rule,
        value,
        current_entries.map((entry) => entry.entry_id),
      ) as JsonRecord[];
    } catch (cause) {
      throw new AppErrors.AppError("request.validation_failed", { cause });
    }
  }

  /**
   * 缺失规则切片按空记录返回，由页面使用领域默认值补齐。
   */
  private normalize_record(value: unknown): JsonRecord {
    return is_json_record(value) ? (value as JsonRecord) : {};
  }

  /**
   * 按扩展名读取规则文件，保持导入格式分发集中
   */
  private async load_rules_from_file(file_path: string): Promise<unknown[]> {
    return load_quality_rule_entries_from_file(file_path, this.native_fs);
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
