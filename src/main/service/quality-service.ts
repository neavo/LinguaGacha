import fs from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";
import type { Row } from "exceljs";

import { app_error } from "../api/api-error";
import { ProjectDatabase } from "../database/database-operations";
import type { DatabaseJsonValue, DatabaseOperation } from "../database/database-types";
import type { ApiJsonValue } from "../api/api-types";
import { AppPathService } from "./path-service";
import { SettingService } from "./setting-service";
import { JsonTool } from "../../shared/utils/json-tool";
import { SpreadsheetTool } from "../../shared/utils/spreadsheet-tool";
import {
  build_project_mutation_ack_from_meta,
  get_runtime_section_revision,
} from "../project/project-section-revision";
import { ProjectChangePublisher } from "../project/project-change-publisher";
import { ProjectSessionState } from "../project/project-session-state";
import { QualityRule, type QualityRuleKind } from "../../base/quality";
import { Prompt, type PromptKind } from "../../base/prompt";

type JsonRecord = Record<string, ApiJsonValue>;

/**
 * 封装 质量规则与提示词 CRUD、预设 IO 和 revision 对齐
 */
export class QualityService {
  private readonly paths: AppPathService; // paths 统一解析内置 / 用户预设目录，服务层不在调用点拼接路径

  private readonly setting_service: SettingService; // 提示词模板语言跟随应用配置，因此质量服务需要配置读取能力

  private readonly database: ProjectDatabase; // 质量规则和提示词工程事实只通过 ProjectDatabase workflow 读写

  private readonly session_state: ProjectSessionState; // 页面级质量规则 / 提示词写入口以 会话状态作为当前工程目标

  private readonly project_change_publisher: ProjectChangePublisher | null; // 写库成功后统一发布 project.data_changed，HTTP ack 不承载最终项目事实

  /**
   * 初始化 QualityService 依赖，保持外部写入口清晰
   */
  public constructor(
    paths: AppPathService,
    setting_service: SettingService,
    database: ProjectDatabase,
    session_state: ProjectSessionState,
    project_change_publisher: ProjectChangePublisher | null = null,
  ) {
    this.paths = paths;
    this.setting_service = setting_service;
    this.database = database;
    this.session_state = session_state;
    this.project_change_publisher = project_change_publisher;
  }

  /**
   * 保存规则条目并返回 mutation ack，保持页面 revision 对齐
   */
  public async save_rule_entries(request: JsonRecord): Promise<JsonRecord> {
    const rule_type = this.normalize_rule_type(request["rule_type"]);
    const expected_revision = Number(request["expected_revision"] ?? 0);
    const entries = this.normalize_rule_entries(request["entries"]);
    const project_path = await this.require_project_path();
    const current_revision = this.get_rule_revision(project_path, rule_type);
    this.assert_revision(current_revision, expected_revision, "质量规则 revision 冲突");
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
    this.publish_project_data_change("quality_rule_save_entries", ["quality"]);
    return this.build_project_mutation_ack(project_path, ["quality"]);
  }

  /**
   * 更新规则 meta 并返回 mutation ack，避免页面直接改工程事实
   */
  public async update_rule_meta(request: JsonRecord): Promise<JsonRecord> {
    const rule_type = this.normalize_rule_type(request["rule_type"]);
    const project_path = await this.require_project_path();
    let current_revision = this.get_rule_revision(project_path, rule_type);
    let expected_revision = Number(request["expected_revision"] ?? 0);
    const meta = this.normalize_object(request["meta"]);
    for (const [key, value] of Object.entries(meta)) {
      this.assert_revision(current_revision, expected_revision, "质量规则 revision 冲突");
      const meta_key = this.resolve_rule_meta_key(rule_type, key);
      const meta_value = this.normalize_rule_meta_value(rule_type, key, value);
      current_revision += 1;
      this.database.execute_transaction([
        this.op("setMeta", { projectPath: project_path, key: meta_key, value: meta_value }),
        this.op("setMeta", {
          projectPath: project_path,
          key: this.build_rule_revision_key(rule_type),
          value: current_revision,
        }),
      ]);
      expected_revision = current_revision;
    }
    if (Object.keys(meta).length > 0) {
      this.publish_project_data_change("quality_rule_update_meta", ["quality"]);
    }
    return this.build_project_mutation_ack(project_path, ["quality"]);
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
    const data = JsonTool.parseStrict(fs.readFileSync(preset_path)) as unknown;
    if (!Array.isArray(data)) {
      throw app_error("validation_failed", "质量规则预设载荷无效。", {
        filename: path.basename(preset_path),
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
    fs.mkdirSync(directory, { recursive: true });
    const file_name = `${name}.json`;
    fs.writeFileSync(
      path.join(directory, file_name),
      JsonTool.stringifyStrict(entries, { indent: 4 }),
      "utf-8",
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
      throw app_error("validation_failed", "内置预设不能重命名。");
    }
    const directory = this.paths.get_quality_rule_user_preset_dir(preset_directory);
    const new_file_name = `${this.normalize_preset_name(String(request["new_name"] ?? ""))}.json`;
    fs.renameSync(path.join(directory, file_name), path.join(directory, new_file_name));
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
      throw app_error("validation_failed", "内置预设不能删除。");
    }
    const file_path = path.join(
      this.paths.get_quality_rule_user_preset_dir(preset_directory),
      file_name,
    );
    fs.rmSync(file_path);
    return { path: file_path.replace(/\\/g, "/") };
  }

  /**
   * 读取提示词模板，保持任务类型到模板路径的映射集中
   */
  public get_prompt_template(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const config = this.setting_service.load_setting();
    const language = String(config["app_language"] ?? "ZH").toLowerCase();
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
   * 保存工程提示词并返回 mutation ack，保持 prompts revision 对齐
   */
  public async save_prompt(request: JsonRecord): Promise<JsonRecord> {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const expected_revision = Number(request["expected_revision"] ?? 0);
    const project_path = await this.require_project_path();
    const current_revision = this.get_prompt_revision(project_path, task_type);
    this.assert_revision(current_revision, expected_revision, "提示词 revision 冲突");
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
    this.publish_project_data_change("quality_prompt_save", ["prompts"]);
    return this.build_project_mutation_ack(project_path, ["prompts"]);
  }

  /**
   * 读取提示词导入文本，避免 renderer 触碰文件系统
   */
  public read_prompt_import_text(request: JsonRecord): JsonRecord {
    const file_path = String(request["path"] ?? "");
    return {
      text: fs
        .readFileSync(file_path, "utf-8")
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
    fs.writeFileSync(output_path, text.trim(), "utf-8");
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
    fs.mkdirSync(directory, { recursive: true });
    const file_path = path.join(
      directory,
      `${this.normalize_preset_name(String(request["name"] ?? ""))}.txt`,
    );
    fs.writeFileSync(file_path, String(request["text"] ?? "").trim(), "utf-8");
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
      throw app_error("validation_failed", "内置预设不能重命名。");
    }
    const directory = this.paths.get_prompt_user_preset_dir(task_type);
    const new_file_name = `${this.normalize_preset_name(String(request["new_name"] ?? ""))}.txt`;
    fs.renameSync(path.join(directory, file_name), path.join(directory, new_file_name));
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
      throw app_error("validation_failed", "内置预设不能删除。");
    }
    const file_path = path.join(this.paths.get_prompt_user_preset_dir(task_type), file_name);
    fs.rmSync(file_path);
    return { path: file_path.replace(/\\/g, "/") };
  }

  /**
   * 校验工程路径，确保项目级规则写入有明确目标
   */
  private async require_project_path(): Promise<string> {
    const state = this.session_state.snapshot();
    if (!state.loaded || state.projectPath === "") {
      throw app_error("project_not_loaded");
    }
    return state.projectPath;
  }

  /**
   * 构建 ProjectMutationAck，保持同步 mutation 响应形状一致
   */
  private build_project_mutation_ack(project_path: string, updated_sections: string[]): JsonRecord {
    const meta = this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: project_path })) as ApiJsonValue,
    );
    return build_project_mutation_ack_from_meta(meta, updated_sections);
  }

  /**
   * 项目事实写入成功后只经 ProjectChangePublisher 回流，避免页面把 ack 当数据源
   */
  private publish_project_data_change(
    source: string,
    updated_sections: Array<"quality" | "prompts">,
  ): void {
    this.project_change_publisher?.publish_project_change({
      source,
      updatedSections: updated_sections,
      sections: Object.fromEntries(
        updated_sections.map((section) => [section, { payloadMode: "canonical-delta" }]),
      ) as unknown as ApiJsonValue,
    });
  }

  /**
   * 读取规则 revision，隔离 meta key 组合细节
   */
  private get_rule_revision(project_path: string, rule_type: QualityRuleKind): number {
    return get_runtime_section_revision(
      this.read_project_meta(project_path),
      `quality:${rule_type}`,
    );
  }

  /**
   * 读取提示词 revision，隔离 meta key 组合细节
   */
  private get_prompt_revision(project_path: string, task_type: PromptKind): number {
    return get_runtime_section_revision(
      this.read_project_meta(project_path),
      `prompts:${task_type}`,
    );
  }

  /**
   * revision 读取复用运行态服务的 meta 口径，避免读取接口和 mutation ack 分叉
   */
  private read_project_meta(project_path: string): JsonRecord {
    return this.normalize_object(
      this.database.execute(this.op("getAllMeta", { projectPath: project_path })) as ApiJsonValue,
    );
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
   * 校验期望 revision，避免过期页面覆盖新事实
   */
  private assert_revision(
    current_revision: number,
    expected_revision: number,
    label: string,
  ): void {
    if (current_revision !== expected_revision) {
      throw app_error("revision_conflict", `${label}。`, {
        current_revision,
        expected_revision,
      });
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
    const data = await JsonTool.repairParse(fs.readFileSync(file_path));
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
    await workbook.xlsx.readFile(file_path);
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
    fs.mkdirSync(path.dirname(base_path), { recursive: true });
    fs.writeFileSync(
      `${base_path}.json`,
      JsonTool.stringifyStrict(entries, { indent: 4 }),
      "utf-8",
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
    await workbook.xlsx.writeFile(`${base_path}.xlsx`);
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
      fs.mkdirSync(directory, { recursive: true });
    } else if (!fs.existsSync(directory)) {
      return [];
    }
    const path_dir = resolved_path_dir ?? directory;
    return fs
      .readdirSync(directory)
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
      throw app_error("validation_failed", "预设 ID 无效。");
    }
    const source = parts[0];
    const file_name = parts.at(-1) ?? "";
    if (source !== "builtin" && source !== "user") {
      throw app_error("validation_failed", "预设 ID 无效。");
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
      throw app_error("validation_failed", "预设文件名无效。");
    }
  }

  /**
   * 归一预设显示名，保持文件名和 UI 文案一致
   */
  private normalize_preset_name(name: string): string {
    const normalized_name = name.trim();
    if (normalized_name === "") {
      throw app_error("validation_failed", "预设名称不能为空。");
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
    return fs
      .readFileSync(file_path, "utf-8")
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
