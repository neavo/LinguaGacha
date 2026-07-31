import path from "node:path";

import type { JsonRecord, JsonValue } from "../../domain/json";
import { resolve_preset_file, type AppPathService } from "../app/app-path-service";
import type { AppSettingService } from "../app/app-setting-service";
import type { CacheReadPort } from "../cache/cache-types";
import type { ProjectDatabase } from "../database/database-operations";
import type { ProjectSessionState } from "../project/project-session-state";
import type { ProjectWriteStore } from "../project/project-write-store";
import { require_project_expected_section_revisions } from "../project/project-write-request";
import type { RuntimeOperationGate } from "../runtime-operation-gate";
import { resolve_prompt_template_language } from "../../domain/app-language";
import { is_json_record } from "../../domain/json";
import { Prompt } from "../../domain/prompt";
import { normalize_setting_snapshot } from "../../domain/setting";
import { NativeFs, default_native_fs } from "../../native/native-fs";
import * as AppErrors from "../../shared/error";
import type { ProjectWriteResult } from "../../shared/project-event";
import { fill_translation_output_format_placeholder } from "../../shared/text/translation-output-format";

/**
 * 工程提示词查询、写入、模板与预设文件操作。
 */
export class QualityPromptService {
  /**
   * 注入路径、会话、写入与 cache 读口；IO 默认走 NativeFs。
   */
  public constructor(
    private readonly paths: AppPathService,
    private readonly app_setting_service: AppSettingService,
    private readonly database: ProjectDatabase,
    private readonly session_state: ProjectSessionState,
    private readonly write_store: ProjectWriteStore,
    private readonly runtime_gate: RuntimeOperationGate,
    private readonly cache: CacheReadPort,
    private readonly native_fs: NativeFs = default_native_fs,
  ) {}

  /**
   * 读取单个任务类型的提示词切片。
   */
  public read(request: JsonRecord): JsonRecord {
    const project_path = this.session_state.require_loaded_project_path();
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const prompts_block = this.cache.prompts.readBlock();
    return {
      projectPath: project_path,
      sectionRevisions: this.cache.readSectionRevisions() as unknown as JsonValue,
      prompt: this.normalize_record(prompts_block[task_type]) as unknown as JsonValue,
    };
  }

  /**
   * 读取随应用语言变化的提示词模板。
   */
  public get_template(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const config = normalize_setting_snapshot(this.app_setting_service.read_setting());
    const prompt_language = resolve_prompt_template_language(config.app_language);
    const template_dir = this.paths.get_prompt_template_dir(task_type, prompt_language);
    const fill_template_section = (text: string): string => {
      return task_type === "translation"
        ? fill_translation_output_format_placeholder(text, "text", prompt_language)
        : text;
    };
    return {
      template: {
        default_text: fill_template_section(
          this.read_text_file(path.join(template_dir, "base.txt")),
        ),
        prefix_text: fill_template_section(
          this.read_text_file(path.join(template_dir, "prefix.txt")),
        ),
        suffix_text: fill_template_section(
          this.read_text_file(path.join(template_dir, "suffix.txt")),
        ),
      },
    };
  }

  /**
   * 保存工程提示词。
   */
  public async save(request: JsonRecord): Promise<ProjectWriteResult> {
    return await this.runtime_gate.run_project_write(async () => {
      this.assert_no_legacy_fields(request, ["expected_revision"]);
      const prompt = Prompt.from_json(request["task_type"]);
      const project_path = this.session_state.require_loaded_project_path();
      return await this.write_store.save_prompt({
        projectPath: project_path,
        expectedSectionRevisions: require_project_expected_section_revisions(
          request["expected_section_revisions"],
        ),
        promptRuleType: prompt.database_type,
        text: String(request["text"] ?? ""),
        revisionKey: prompt.revision_meta_key,
        ...(request["enabled"] === undefined || request["enabled"] === null
          ? {}
          : {
              enabledMetaKey: prompt.enabled_meta_key,
              enabled: Boolean(request["enabled"]),
            }),
      });
    });
  }

  /**
   * 读取外部提示词文本。
   */
  public read_import_text(request: JsonRecord): JsonRecord {
    return { text: this.read_text_file(String(request["path"] ?? "")) };
  }

  /**
   * 导出当前工程提示词。
   */
  public async export(request: JsonRecord): Promise<JsonRecord> {
    const prompt = Prompt.from_json(request["task_type"]);
    const project_path = this.session_state.require_loaded_project_path();
    const output_path = this.ensure_txt_suffix(String(request["path"] ?? ""));
    const text = this.database.get_rule_text(project_path, prompt.database_type);
    this.native_fs.write_file_sync(output_path, text.trim());
    return { path: output_path.replace(/\\/g, "/") };
  }

  /**
   * 列出内置和用户提示词预设。
   */
  public list_presets(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    return {
      builtin_presets: this.list_preset_items(
        "builtin",
        this.paths.get_prompt_builtin_preset_dir(task_type),
        this.paths.get_prompt_builtin_preset_relative_dir(task_type),
      ) as unknown as JsonValue,
      user_presets: this.list_preset_items(
        "user",
        this.paths.get_prompt_user_preset_dir(task_type),
      ) as unknown as JsonValue,
    };
  }

  /**
   * 读取提示词预设。
   */
  public read_preset(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    return {
      text: this.read_text_file(
        this.resolve_prompt_preset_file(task_type, String(request["virtual_id"] ?? "")).file_path,
      ),
    };
  }

  /**
   * 保存用户提示词预设。
   */
  public save_preset(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const directory = this.paths.get_prompt_user_preset_dir(task_type);
    this.native_fs.make_dir(directory);
    const preset_file = resolve_preset_file({
      virtual_id: `user:${this.normalize_preset_name(String(request["name"] ?? ""))}.txt`,
      extension: ".txt",
      builtin_directory: directory,
      user_directory: directory,
    });
    this.native_fs.write_file_sync(preset_file.file_path, String(request["text"] ?? "").trim());
    return { path: preset_file.file_path.replace(/\\/g, "/") };
  }

  /**
   * 重命名用户提示词预设。
   */
  public rename_preset(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const current_file = this.resolve_prompt_preset_file(
      task_type,
      String(request["virtual_id"] ?? ""),
    );
    if (current_file.source !== "user") {
      throw new AppErrors.RequestValidationError();
    }
    const directory = this.paths.get_prompt_user_preset_dir(task_type);
    const new_file = resolve_preset_file({
      virtual_id: `user:${this.normalize_preset_name(String(request["new_name"] ?? ""))}.txt`,
      extension: ".txt",
      builtin_directory: directory,
      user_directory: directory,
    });
    this.native_fs.rename(current_file.file_path, new_file.file_path);
    return { item: this.build_preset_item("user", new_file.file_name, directory) };
  }

  /**
   * 删除用户提示词预设。
   */
  public delete_preset(request: JsonRecord): JsonRecord {
    const task_type = Prompt.from_json(request["task_type"]).kind;
    const preset_file = this.resolve_prompt_preset_file(
      task_type,
      String(request["virtual_id"] ?? ""),
    );
    if (preset_file.source !== "user") {
      throw new AppErrors.RequestValidationError();
    }
    this.native_fs.remove(preset_file.file_path);
    return { path: preset_file.file_path.replace(/\\/g, "/") };
  }

  /** cache block 缺失时回空对象，避免页面拿到 null。 */
  private normalize_record(value: unknown): JsonRecord {
    return is_json_record(value) ? (value as JsonRecord) : {};
  }

  /** 拒绝旧 revision 字段，强制走 section revision。 */
  private assert_no_legacy_fields(request: JsonRecord, fields: string[]): void {
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(request, field)) {
        throw new AppErrors.RequestValidationError({
          diagnostic_context: { reason: "legacy_prompt_write_field", field },
        });
      }
    }
  }

  /** 列出目录内 .txt 预设并映射为公开条目。 */
  private list_preset_items(
    source: "builtin" | "user",
    directory: string,
    resolved_path_dir?: string,
  ): JsonRecord[] {
    if (source === "user") {
      this.native_fs.make_dir(directory);
    } else if (!this.native_fs.exists(directory)) {
      return [];
    }
    const path_dir = resolved_path_dir ?? directory;
    return this.native_fs
      .read_dir_names(directory)
      .filter((file_name) => file_name.toLowerCase().endsWith(".txt"))
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
      .map((file_name) => this.build_preset_item(source, file_name, path_dir));
  }

  /** 把文件名收成 virtual_id / path 条目。 */
  private build_preset_item(
    source: "builtin" | "user",
    file_name: string,
    path_dir: string,
  ): JsonRecord {
    const preset_file = resolve_preset_file({
      virtual_id: `${source}:${file_name}`,
      extension: ".txt",
      builtin_directory: path_dir,
      user_directory: path_dir,
    });
    return {
      name: file_name.slice(0, -".txt".length),
      file_name,
      virtual_id: `${source}:${file_name}`,
      path: preset_file.file_path.replace(/\\/g, "/"),
      type: source,
    };
  }

  /** 按 task_type 解析内置 / 用户预设文件。 */
  private resolve_prompt_preset_file(
    task_type: string,
    virtual_id: string,
  ): ReturnType<typeof resolve_preset_file> {
    return resolve_preset_file({
      virtual_id,
      extension: ".txt",
      builtin_directory: this.paths.get_prompt_builtin_preset_dir(task_type),
      user_directory: this.paths.get_prompt_user_preset_dir(task_type),
    });
  }

  /** 预设名去空白后仍为空则拒绝。 */
  private normalize_preset_name(name: string): string {
    const normalized_name = name.trim();
    if (normalized_name === "") {
      throw new AppErrors.RequestValidationError();
    }
    return normalized_name;
  }

  /** 读取文本并去掉 BOM 与首尾空白。 */
  private read_text_file(file_path: string): string {
    return this.native_fs
      .read_text_file(file_path)
      .replace(/^\uFEFF/u, "")
      .trim();
  }

  /** 导出路径没有 .txt 时自动补齐。 */
  private ensure_txt_suffix(file_path: string): string {
    const parsed = path.parse(file_path);
    if (parsed.ext.toLowerCase() === ".txt") {
      return file_path;
    }
    return parsed.ext === "" ? `${file_path}.txt` : path.join(parsed.dir, `${parsed.name}.txt`);
  }
}
