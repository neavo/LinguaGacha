import path from "node:path";

import ExcelJS from "exceljs";
import type { Row } from "exceljs";

import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import type { ApiJsonValue } from "../api/api-types";
import { AppPathService } from "../app/app-path-service";
import { AppSettingService } from "../app/app-setting-service";
import { JsonTool } from "../../shared/utils/json-tool";
import { SpreadsheetTool } from "../../shared/utils/spreadsheet-tool";
import { get_runtime_section_revision } from "../project/project-section-revision";
import { ProjectMutationCoordinator } from "../project/project-mutation-coordinator";
import { ProjectChangePublisher } from "../project/project-change-publisher";
import { ProjectSessionState } from "../project/project-session-state";
import type { ProjectMutationResult } from "../../shared/project/event";
import { QualityRule, type QualityRuleKind } from "../../base/quality";
import { Prompt, type PromptKind } from "../../base/prompt";
import { normalize_setting_snapshot } from "../../base/setting";
import * as AppErrors from "../../shared/error";
import {
  NativeFs,
  default_native_fs,
  normalize_native_file_bytes,
} from "../../native/platform/native-fs";

type JsonRecord = Record<string, ApiJsonValue>;

/**
 * 封装 质量规则与提示词 CRUD、预设 IO 和 revision 对齐
 */
export class QualityService {
  private readonly paths: AppPathService; // paths 统一解析内置 / 用户预设目录，服务层不在调用点拼接路径

  private readonly app_setting_service: AppSettingService; // 提示词模板语言跟随应用配置，因此质量服务需要配置读取能力

  private readonly database: ProjectDatabase; // 质量规则和提示词工程事实只通过 ProjectDatabase workflow 读写

  private readonly session_state: ProjectSessionState; // 页面级质量规则 / 提示词写入口以 会话状态作为当前工程目标

  private readonly mutation_coordinator: ProjectMutationCoordinator; // 质量与提示词 mutation 复用项目域统一 revision guard 和 canonical 事件发布

  private readonly native_fs: NativeFs; // native_fs 是规则、提示词预设和导入导出的唯一文件 IO 入口

  /**
   * 初始化 QualityService 依赖，保持外部写入口清晰
   */
  public constructor(
    paths: AppPathService,
    app_setting_service: AppSettingService,
    database: ProjectDatabase,
    session_state: ProjectSessionState,
    project_change_publisher: ProjectChangePublisher | null = null,
    native_fs: NativeFs = default_native_fs,
  ) {
    this.paths = paths;
    this.app_setting_service = app_setting_service;
    this.database = database;
    this.session_state = session_state;
    this.mutation_coordinator = new ProjectMutationCoordinator(database, project_change_publisher);
    this.native_fs = native_fs;
  }

  /**
   * 保存规则条目并返回后端 canonical mutation 结果
   */
  public async save_rule_entries(request: JsonRecord): Promise<ProjectMutationResult> {
    this.assert_no_legacy_fields(request, ["expected_revision"]);
    const rule_type = this.normalize_rule_type(request["rule_type"]);
    const entries = this.normalize_rule_entries(request["entries"]);
    const project_path = await this.require_project_path();
    const revision_context = this.mutation_coordinator.assert_expected_section_revisions(
      project_path,
      request["expected_section_revisions"],
      ["quality"],
    );
    const current_revision = get_runtime_section_revision(revision_context.meta, "quality");
    this.database.execute_transaction([
      this.op("setRules", {
        projectPath: project_path,
        ruleType: QualityRule.from_json(rule_type).database_type,
        rules: entries as unknown as DatabaseJsonValue,
      }),
      this.op("setMeta", {
        projectPath: project_path,
        key: this.build_rule_revision_key(rule_type),
        value: current_revision + 1,
      }),
    ]);
    return this.mutation_coordinator.publish_project_data_change({
      projectPath: project_path,
      source: "quality_rule_save_entries",
      updatedSections: ["quality"],
    });
  }

  /**
   * 更新规则 meta 并返回后端 canonical mutation 结果
   */
  public async update_rule_meta(request: JsonRecord): Promise<ProjectMutationResult> {
    this.assert_no_legacy_fields(request, ["expected_revision"]);
    const rule_type = this.normalize_rule_type(request["rule_type"]);
    const project_path = await this.require_project_path();
    const revision_context = this.mutation_coordinator.assert_expected_section_revisions(
      project_path,
      request["expected_section_revisions"],
      ["quality"],
    );
    const current_revision = get_runtime_section_revision(revision_context.meta, "quality");
    const meta = this.normalize_object(request["meta"]);
    if (Object.keys(meta).length === 0) {
      return this.mutation_coordinator.empty_project_mutation_result();
    }
    const operations: DatabaseOperation[] = [];
    for (const [key, value] of Object.entries(meta)) {
      const meta_key = this.resolve_rule_meta_key(rule_type, key);
      const meta_value = this.normalize_rule_meta_value(rule_type, key, value);
      operations.push(
        this.op("setMeta", { projectPath: project_path, key: meta_key, value: meta_value }),
      );
    }
    operations.push(
      this.op("setMeta", {
        projectPath: project_path,
        key: this.build_rule_revision_key(rule_type),
        value: current_revision + 1,
      }),
    );
    this.database.execute_transaction(operations);
    return this.mutation_coordinator.publish_project_data_change({
      projectPath: project_path,
      source: "quality_rule_update_meta",
      updatedSections: ["quality"],
    });
  }

  /**
   * 从外部文件导入规则预演结果，保持导入解析在服务内收口
   */
  public async import_rules(request: JsonRecord): Promise<JsonRecord> {
    const file_path = String(request["path"] ?? "");
    return { entries: (await this.load_rules_from_file(file_path)) as unknown as ApiJsonValue };
  }

  /**
   * 导出规则到用户选择路径，避免页面处理文件格式细节
   */
  public async export_rules(request: JsonRecord): Promise<JsonRecord> {
    const file_path = String(request["path"] ?? "");
    const entries = this.normalize_rule_entries(request["entries"]);
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
      ) as unknown as ApiJsonValue,
      user_presets: this.list_preset_items(
        "user",
        this.paths.get_quality_rule_user_preset_dir(preset_directory),
        undefined,
        ".json",
      ) as unknown as ApiJsonValue,
    };
  }

  /**
   * 读取规则预设内容，隐藏内置和用户目录差异
   */
  public read_rule_preset(request: JsonRecord): JsonRecord {
    const preset_directory = QualityRule.from_json(request["rule_type"]).preset_directory;
    const preset_path = this.resolve_rule_preset_path(
      preset_directory,
      String(request["virtual_id"] ?? ""),
    );
    const data = JsonTool.parseStrict(this.native_fs.read_file(preset_path)) as unknown;
    if (!Array.isArray(data)) {
      throw new AppErrors.RequestValidationError({
        public_details: {
          filename: path.basename(preset_path),
        },
      });
    }
    return { entries: data as unknown as ApiJsonValue };
  }

  /**
   * 保存用户规则预设，确保文件名和目录规则一致
   */
  public save_rule_preset(request: JsonRecord): JsonRecord {
    const preset_directory = QualityRule.from_json(request["rule_type"]).preset_directory;
    const name = this.normalize_preset_name(String(request["name"] ?? ""));
    const entries = this.normalize_rule_entries(request["entries"]);
    const directory = this.paths.get_quality_rule_user_preset_dir(preset_directory);
    this.native_fs.make_dir(directory);
    const file_name = `${name}.json`;
    this.native_fs.write_file_sync(
      path.join(directory, file_name),
      JsonTool.stringifyStrict(entries, { indent: 4 }),
    );
    return { item: this.build_preset_item("user", file_name, directory, ".json") };
  }

  /**
   * 重命名用户规则预设，保护内置预设不可变边界
   */
  public rename_rule_preset(request: JsonRecord): JsonRecord {
    const preset_directory = QualityRule.from_json(request["rule_type"]).preset_directory;
    const { source, file_name } = this.split_virtual_id(
      String(request["virtual_id"] ?? ""),
      ".json",
    );
    if (source !== "user") {
      throw new AppErrors.RequestValidationError();
    }
    const directory = this.paths.get_quality_rule_user_preset_dir(preset_directory);
    const new_file_name = `${this.normalize_preset_name(String(request["new_name"] ?? ""))}.json`;
    this.native_fs.rename(path.join(directory, file_name), path.join(directory, new_file_name));
    return { item: this.build_preset_item("user", new_file_name, directory, ".json") };
  }

  /**
   * 删除用户规则预设，避免调用方误删内置资源
   */
  public delete_rule_preset(request: JsonRecord): JsonRecord {
    const preset_directory = QualityRule.from_json(request["rule_type"]).preset_directory;
    const { source, file_name } = this.split_virtual_id(
      String(request["virtual_id"] ?? ""),
      ".json",
    );
    if (source !== "user") {
      throw new AppErrors.RequestValidationError();
    }
    const file_path = path.join(
      this.paths.get_quality_rule_user_preset_dir(preset_directory),
      file_name,
    );
    this.native_fs.remove(file_path);
    return { path: file_path.replace(/\\/g, "/") };
  }

  /**
   * 读取提示词模板，保持任务类型到模板路径的映射集中
   */
  public get_prompt_template(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const config = normalize_setting_snapshot(this.app_setting_service.read_setting());
    const language = config.app_language.toLowerCase();
    const template_dir = this.paths.get_prompt_template_dir(
      task_type,
      language === "en" ? "en" : "zh",
    );
    return {
      template: {
        default_text: this.read_text_file(path.join(template_dir, "base.txt")),
        prefix_text: this.read_text_file(path.join(template_dir, "prefix.txt")),
        suffix_text: this.read_text_file(path.join(template_dir, "suffix.txt")),
      },
    };
  }

  /**
   * 保存工程提示词并返回后端 canonical mutation 结果
   */
  public async save_prompt(request: JsonRecord): Promise<ProjectMutationResult> {
    this.assert_no_legacy_fields(request, ["expected_revision"]);
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const project_path = await this.require_project_path();
    const revision_context = this.mutation_coordinator.assert_expected_section_revisions(
      project_path,
      request["expected_section_revisions"],
      ["prompts"],
    );
    const current_revision = get_runtime_section_revision(revision_context.meta, "prompts");
    const operations: DatabaseOperation[] = [
      this.op("setRuleText", {
        projectPath: project_path,
        ruleType: Prompt.from_json(task_type).database_type,
        text: String(request["text"] ?? ""),
      }),
      this.op("setMeta", {
        projectPath: project_path,
        key: this.prompt_revision_key(task_type),
        value: current_revision + 1,
      }),
    ];
    if (request["enabled"] !== undefined && request["enabled"] !== null) {
      operations.push(
        this.op("setMeta", {
          projectPath: project_path,
          key: Prompt.from_json(task_type).enabled_meta_key,
          value: Boolean(request["enabled"]),
        }),
      );
    }
    this.database.execute_transaction(operations);
    return this.mutation_coordinator.publish_project_data_change({
      projectPath: project_path,
      source: "quality_prompt_save",
      updatedSections: ["prompts"],
    });
  }

  /**
   * 读取提示词导入文本，避免 renderer 触碰文件系统
   */
  public read_prompt_import_text(request: JsonRecord): JsonRecord {
    const file_path = String(request["path"] ?? "");
    return {
      text: this.native_fs
        .read_text_file(file_path)
        .replace(/^\uFEFF/, "")
        .trim(),
    };
  }

  /**
   * 导出提示词文本，保持文件写出留在 Electron main
   */
  public async export_prompt(request: JsonRecord): Promise<JsonRecord> {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const project_path = await this.require_project_path();
    const output_path = this.ensure_txt_suffix(String(request["path"] ?? ""));
    const text = String(
      this.database.execute(
        this.op("getRuleText", {
          projectPath: project_path,
          ruleType: Prompt.from_json(task_type).database_type,
        }),
      ) ?? "",
    );
    this.native_fs.write_file_sync(output_path, text.trim());
    return { path: output_path.replace(/\\/g, "/") };
  }

  /**
   * 列出提示词预设，统一内置和用户预设的虚拟 id
   */
  public list_prompt_presets(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    return {
      builtin_presets: this.list_preset_items(
        "builtin",
        this.paths.get_prompt_builtin_preset_dir(task_type),
        this.paths.get_prompt_builtin_preset_relative_dir(task_type),
        ".txt",
      ) as unknown as ApiJsonValue,
      user_presets: this.list_preset_items(
        "user",
        this.paths.get_prompt_user_preset_dir(task_type),
        undefined,
        ".txt",
      ) as unknown as ApiJsonValue,
    };
  }

  /**
   * 读取提示词预设文本，隐藏资源目录差异
   */
  public read_prompt_preset(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const preset_path = this.resolve_prompt_preset_path(
      task_type,
      String(request["virtual_id"] ?? ""),
    );
    return { text: this.read_text_file(preset_path) };
  }

  /**
   * 保存用户提示词预设，统一命名和后缀规则
   */
  public save_prompt_preset(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const directory = this.paths.get_prompt_user_preset_dir(task_type);
    this.native_fs.make_dir(directory);
    const file_path = path.join(
      directory,
      `${this.normalize_preset_name(String(request["name"] ?? ""))}.txt`,
    );
    this.native_fs.write_file_sync(file_path, String(request["text"] ?? "").trim());
    return { path: file_path.replace(/\\/g, "/") };
  }

  /**
   * 重命名用户提示词预设，保护内置预设只读
   */
  public rename_prompt_preset(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const { source, file_name } = this.split_virtual_id(
      String(request["virtual_id"] ?? ""),
      ".txt",
    );
    if (source !== "user") {
      throw new AppErrors.RequestValidationError();
    }
    const directory = this.paths.get_prompt_user_preset_dir(task_type);
    const new_file_name = `${this.normalize_preset_name(String(request["new_name"] ?? ""))}.txt`;
    this.native_fs.rename(path.join(directory, file_name), path.join(directory, new_file_name));
    return { item: this.build_preset_item("user", new_file_name, directory, ".txt") };
  }

  /**
   * 删除用户提示词预设，避免调用方自行判断预设来源
   */
  public delete_prompt_preset(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const { source, file_name } = this.split_virtual_id(
      String(request["virtual_id"] ?? ""),
      ".txt",
    );
    if (source !== "user") {
      throw new AppErrors.RequestValidationError();
    }
    const file_path = path.join(this.paths.get_prompt_user_preset_dir(task_type), file_name);
    this.native_fs.remove(file_path);
    return { path: file_path.replace(/\\/g, "/") };
  }

  /**
   * 校验工程路径，确保项目级规则写入有明确目标
   */
  private async require_project_path(): Promise<string> {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw new AppErrors.ProjectNotLoadedError();
    }
    return state.projectPath;
  }

  /**
   * 生成规则 revision key，避免调用方拼接 meta 名称
   */
  private build_rule_revision_key(rule_type: QualityRuleKind): string {
    return QualityRule.from_json(rule_type).revision_meta_key;
  }

  /**
   * 生成提示词 revision key，避免调用方拼接 meta 名称
   */
  private prompt_revision_key(task_type: PromptKind): string {
    return Prompt.from_json(task_type).revision_meta_key;
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
    value: ApiJsonValue,
  ): ApiJsonValue {
    return QualityRule.from_json(rule_type).normalize_meta_value(key, value) as ApiJsonValue;
  }

  /**
   * 旧单 revision 字段不再作为兼容层进入服务边界
   */
  private assert_no_legacy_fields(request: JsonRecord, fields: string[]): void {
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(request, field)) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "legacy_quality_mutation_field", field },
        });
      }
    }
  }

  /**
   * 创建 database workflow 操作对象，避免各处重复组装协议
   */
  private op(name: string, args: Record<string, DatabaseJsonValue>): DatabaseOperation {
    return { name, args };
  }

  /**
   * 归一规则类型，保护质量规则接口只接受已知分组
   */
  private normalize_rule_type(value: ApiJsonValue | undefined): QualityRuleKind {
    return QualityRule.from_json(value).kind;
  }

  /**
   * 归一规则条目列表，确保写入数据库前字段完整
   */
  private normalize_rule_entries(value: ApiJsonValue | undefined): JsonRecord[] {
    return QualityRule.normalize_entries(value) as JsonRecord[];
  }

  /**
   * 归一单条规则，兼容导入和页面编辑两种来源
   */
  private normalize_rule_entry(entry: JsonRecord): JsonRecord {
    return QualityRule.normalize_entry(entry) as JsonRecord;
  }

  /**
   * 按扩展名读取规则文件，保持导入格式分发集中
   */
  private async load_rules_from_file(file_path: string): Promise<JsonRecord[]> {
    if (file_path === "") {
      return [];
    }
    const lower_path = file_path.toLowerCase();
    if (lower_path.endsWith(".json")) {
      return this.load_rules_from_json(file_path);
    }
    if (lower_path.endsWith(".xlsx")) {
      return this.load_rules_from_xlsx(file_path);
    }
    return [];
  }

  /**
   * 读取 JSON 规则文件，兼容数组和对象包装格式
   */
  private async load_rules_from_json(file_path: string): Promise<JsonRecord[]> {
    const data = await JsonTool.repairParse(this.native_fs.read_file(file_path));
    const result: JsonRecord[] = [];
    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          continue;
        }
        const record = item as JsonRecord;
        if ("src" in record) {
          const normalized = this.normalize_rule_entry(record);
          if (normalized["src"] !== "") {
            result.push(normalized);
          }
        }
        if (typeof record["id"] === "number") {
          const actor_id = Number(record["id"]);
          const name = String(record["name"] ?? "").trim();
          const nickname = String(record["nickname"] ?? "").trim();
          if (name !== "") {
            result.push(
              this.normalize_rule_entry({
                src: `\\n[${actor_id.toString()}]`,
                dst: name,
                info: "",
                regex: false,
                case_sensitive: false,
              }),
            );
            result.push(
              this.normalize_rule_entry({
                src: `\\N[${actor_id.toString()}]`,
                dst: name,
                info: "",
                regex: false,
                case_sensitive: false,
              }),
            );
          }
          if (nickname !== "") {
            result.push(
              this.normalize_rule_entry({
                src: `\\nn[${actor_id.toString()}]`,
                dst: nickname,
                info: "",
                regex: false,
                case_sensitive: false,
              }),
            );
            result.push(
              this.normalize_rule_entry({
                src: `\\NN[${actor_id.toString()}]`,
                dst: nickname,
                info: "",
                regex: false,
                case_sensitive: false,
              }),
            );
          }
        }
      }
    } else if (typeof data === "object" && data !== null) {
      for (const [src, dst] of Object.entries(data as Record<string, unknown>)) {
        result.push(
          this.normalize_rule_entry({
            src,
            dst: String(dst ?? ""),
            info: "",
            regex: false,
            case_sensitive: false,
          }),
        );
      }
    }
    return result.filter((item) => item["src"] !== "");
  }

  /**
   * 读取 Excel 规则文件，保持表格导入规则集中
   */
  private async load_rules_from_xlsx(file_path: string): Promise<JsonRecord[]> {
    const workbook = new ExcelJS.Workbook();
    await (workbook.xlsx.load as (data: unknown) => Promise<ExcelJS.Workbook>)(
      this.native_fs.read_file(file_path),
    );
    const worksheet = workbook.worksheets[0];
    if (worksheet === undefined) {
      return [];
    }
    const result: JsonRecord[] = [];
    worksheet.eachRow((row) => {
      const src = this.read_excel_cell_text(row, 1);
      const dst = this.read_excel_cell_text(row, 2);
      if (src === "" || (src === "src" && dst === "dst")) {
        return;
      }
      result.push(
        this.normalize_rule_entry({
          src,
          dst,
          info: this.read_excel_cell_text(row, 3),
          regex: this.read_excel_cell_text(row, 4).toLowerCase() === "true",
          case_sensitive: this.read_excel_cell_text(row, 5).toLowerCase() === "true",
        }),
      );
    });
    return result;
  }

  /**
   * 按目标扩展名导出规则，隐藏 JSON 与表格写出差异
   */
  private async export_rules_to_files(base_path: string, entries: JsonRecord[]): Promise<void> {
    this.native_fs.write_file_sync(
      `${base_path}.json`,
      JsonTool.stringifyStrict(entries, { indent: 4 }),
    );
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("rules");
    worksheet.columns = [{ width: 24 }, { width: 24 }, { width: 24 }, { width: 24 }, { width: 24 }];
    ["src", "dst", "info", "regex", "case_sensitive"].forEach((value, index) => {
      SpreadsheetTool.setCellValue(worksheet, 1, index + 1, value, 10);
    });
    entries.forEach((entry, index) => {
      const row = index + 2;
      SpreadsheetTool.setCellValue(worksheet, row, 1, entry["src"] ?? "", 10);
      SpreadsheetTool.setCellValue(worksheet, row, 2, entry["dst"] ?? "", 10);
      SpreadsheetTool.setCellValue(worksheet, row, 3, entry["info"] ?? "", 10);
      SpreadsheetTool.setCellValue(worksheet, row, 4, entry["regex"] ?? "", 10);
      SpreadsheetTool.setCellValue(worksheet, row, 5, entry["case_sensitive"] ?? "", 10);
    });
    this.native_fs.write_file_sync(
      `${base_path}.xlsx`,
      normalize_native_file_bytes(await workbook.xlsx.writeBuffer()),
    );
  }

  /**
   * 读取 Excel 单元格文本，统一空值和字符串转换
   */
  private read_excel_cell_text(row: Row, column_number: number): string {
    return SpreadsheetTool.cellValueToText(row.getCell(column_number).value).trim();
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
    this.ensure_preset_file_name(file_name, extension);
    return {
      name: file_name.slice(0, -extension.length),
      file_name,
      virtual_id: `${source}:${file_name}`,
      path: path.join(path_dir, file_name).replace(/\\/g, "/"),
      type: source,
    };
  }

  /**
   * 解析规则预设路径，保护内置与用户预设边界
   */
  private resolve_rule_preset_path(preset_directory: string, virtual_id: string): string {
    const { source, file_name } = this.split_virtual_id(virtual_id, ".json");
    const directory =
      source === "builtin"
        ? this.paths.get_quality_rule_builtin_preset_dir(preset_directory)
        : this.paths.get_quality_rule_user_preset_dir(preset_directory);
    return path.join(directory, file_name);
  }

  /**
   * 解析提示词预设路径，保护内置与用户预设边界
   */
  private resolve_prompt_preset_path(task_type: string, virtual_id: string): string {
    const { source, file_name } = this.split_virtual_id(virtual_id, ".txt");
    const directory =
      source === "builtin"
        ? this.paths.get_prompt_builtin_preset_dir(task_type)
        : this.paths.get_prompt_user_preset_dir(task_type);
    return path.join(directory, file_name);
  }

  /**
   * 拆分预设虚拟 id，避免路径来源判断散落
   */
  private split_virtual_id(
    virtual_id: string,
    extension: ".json" | ".txt",
  ): { source: "builtin" | "user"; file_name: string } {
    const parts = virtual_id.split(":");
    if (parts.length !== 2 && !(extension === ".json" && parts.length === 3)) {
      throw new AppErrors.RequestValidationError();
    }
    const source = parts[0];
    const file_name = parts.at(-1) ?? "";
    if (source !== "builtin" && source !== "user") {
      throw new AppErrors.RequestValidationError();
    }
    this.ensure_preset_file_name(file_name, extension);
    return { source, file_name };
  }

  /**
   * 校验预设文件名，防止用户输入逃逸预设目录
   */
  private ensure_preset_file_name(file_name: string, extension: ".json" | ".txt"): void {
    const has_path_boundary =
      path.basename(file_name) !== file_name ||
      path.win32.basename(file_name) !== file_name ||
      path.posix.basename(file_name) !== file_name ||
      path.isAbsolute(file_name) ||
      path.win32.isAbsolute(file_name) ||
      path.posix.isAbsolute(file_name);
    if (file_name === "" || has_path_boundary || !file_name.toLowerCase().endsWith(extension)) {
      throw new AppErrors.RequestValidationError();
    }
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
   * 收窄未知 JSON 为对象，避免深层读取抛出隐式异常
   */
  private normalize_object(value: ApiJsonValue | undefined): JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  }

  /**
   * 从未知值读取数字，兼容字符串数字和缺省值
   */
  private read_number(value: ApiJsonValue | undefined): number {
    const number_value = Number(value ?? 0);
    return Number.isFinite(number_value) && number_value >= 0 ? number_value : 0;
  }

  /**
   * 读取文本文件，统一文件不存在和编码边界
   */
  private read_text_file(file_path: string): string {
    return this.native_fs
      .read_text_file(file_path)
      .replace(/^\uFEFF/, "")
      .trim();
  }

  /**
   * 移除文件扩展名，保持预设显示名生成一致
   */
  private without_extension(file_path: string): string {
    const parsed = path.parse(file_path);
    return path.join(parsed.dir, parsed.name);
  }

  /**
   * 补齐 txt 后缀，保持提示词预设文件格式稳定
   */
  private ensure_txt_suffix(file_path: string): string {
    const parsed = path.parse(file_path);
    if (parsed.ext.toLowerCase() === ".txt") {
      return file_path;
    }
    return parsed.ext === "" ? `${file_path}.txt` : path.join(parsed.dir, `${parsed.name}.txt`);
  }
}
