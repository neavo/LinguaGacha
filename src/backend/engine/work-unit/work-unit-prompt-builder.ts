import path from "node:path";

import { JsonTool } from "../../../shared/utils/json-tool";
import {
  build_translation_output_format,
  type TranslationPromptLanguage,
} from "../../../shared/text/translation-output-format";
import type { TextQualitySnapshot, TextTaskItemRecord } from "../../../shared/text/text-types";
import type { LLMMessage } from "../../llm/llm-types";
import { default_native_fs } from "../../../native/native-fs";
import { Prompt } from "../../../domain/prompt";
import { normalize_setting_snapshot, type SettingSnapshot } from "../../../domain/setting";
import {
  resolve_app_locale,
  resolve_language_display_locale,
  resolve_prompt_template_language,
} from "../../../domain/app-language";
import { format_i18n_message, type LocaleKey } from "../../../shared/i18n";
import {
  get_prompt_source_language_name,
  get_prompt_target_language_name,
  normalize_language_code,
} from "../../../domain/language";
import type { TranslationRequestItem, TranslationPromptMode } from "./translation-item";
import { format_glossary_entry, type GlossaryEntry } from "../../../shared/quality/glossary";

/**
 * 提示词构造所需的最小配置快照，worker 只读取语言与提示词增强开关
 */
export type PromptBuilderConfig = Pick<
  SettingSnapshot,
  "app_language" | "source_language" | "target_language" | "prompt_enhancement_enable"
>;

/**
 * PromptBuilder 输出给 LLM adapter 的消息和本地日志展示文本
 */
export interface PromptBuildResult {
  messages: LLMMessage[];
  console_log: string[];
}

/**
 * worker 侧提示词构造器，读取资源模板并拼接本次 work unit 动态数据
 */
export class PromptBuilder {
  private static readonly template_cache = new Map<string, string>();

  private readonly app_root: string;
  private readonly config: PromptBuilderConfig;
  private readonly quality_snapshot: TextQualitySnapshot;
  private readonly activated_glossary_entries: readonly GlossaryEntry[];

  /**
   * app_root 由 Electron main 注入，worker 不自行猜测资源根
   */
  public constructor(
    app_root: string,
    config: Partial<PromptBuilderConfig>,
    quality_snapshot: TextQualitySnapshot,
    activated_glossary_entries: readonly GlossaryEntry[],
  ) {
    const setting_snapshot = normalize_setting_snapshot(config);
    this.app_root = app_root;
    this.config = {
      app_language: setting_snapshot.app_language,
      source_language: setting_snapshot.source_language,
      target_language: setting_snapshot.target_language,
      prompt_enhancement_enable: setting_snapshot.prompt_enhancement_enable,
    };
    this.quality_snapshot = quality_snapshot;
    this.activated_glossary_entries = activated_glossary_entries;
  }

  /**
   * 生成普通翻译提示词；system 放稳定指令，user 放本次输入和术语
   */
  public async generate_prompt(
    items: TranslationRequestItem[],
    mode: TranslationPromptMode,
    samples: string[],
    precedings: TextTaskItemRecord[],
  ): Promise<PromptBuildResult> {
    const messages: LLMMessage[] = [];
    const console_log: string[] = [];
    const instruction_text = await this.build_main(mode);
    const user_parts: string[] = [];

    const preceding = this.build_preceding(precedings);
    if (preceding !== "") {
      user_parts.push(preceding);
      console_log.push(preceding);
    }

    const glossary = this.build_glossary(" -> ");
    if (glossary !== "") {
      user_parts.push(glossary);
      console_log.push(glossary);
    }

    const control_samples = this.build_control_characters_samples(instruction_text, samples);
    if (control_samples !== "") {
      user_parts.push(control_samples);
      console_log.push(control_samples);
    }

    const inputs = this.build_inputs(items, mode);
    if (inputs !== "") {
      user_parts.push(inputs);
    }

    messages.push({ role: "system", content: instruction_text });
    messages.push({ role: "user", content: user_parts.join("\n\n") });
    return { messages, console_log };
  }

  /**
   * 生成 SakuraLLM 固定提示词，保持旧模型专用语义
   */
  public generate_prompt_sakura(srcs: string[]): PromptBuildResult {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content:
          "你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。",
      },
    ];
    const console_log: string[] = [];
    let content = `将下面的日文文本翻译成中文：\n${srcs.join("\n")}`;
    const glossary = this.build_glossary("->", false);
    if (glossary !== "") {
      content = `根据以下术语表（可以为空）：\n${glossary}\n将下面的日文文本根据对应关系和备注翻译成中文：\n${srcs.join("\n")}`;
      console_log.push(glossary);
    }
    messages.push({ role: "user", content });
    return { messages, console_log };
  }

  /**
   * 生成术语分析提示词；分析链路不混入上文或翻译控制字符示例
   */
  public async generate_glossary_prompt(srcs: string[]): Promise<PromptBuildResult> {
    const instruction_text = await this.build_glossary_analysis_main();
    const inputs_text = this.build_analysis_inputs(srcs);
    return {
      messages: [
        { role: "system", content: instruction_text },
        { role: "user", content: inputs_text },
      ],
      console_log: [],
    };
  }

  /**
   * 翻译主提示词从自定义快照或资源模板读取
   */
  public async build_main(mode: TranslationPromptMode = "text"): Promise<string> {
    const context = this.resolve_prompt_context();
    const prompt = Prompt.translation();
    const prefix = await this.read_prompt_text(
      prompt.directory_name,
      context.prompt_language,
      "prefix.txt",
    );
    const base = this.quality_snapshot.translation_prompt_enable
      ? this.quality_snapshot.translation_prompt
      : await this.read_prompt_text(prompt.directory_name, context.prompt_language, "base.txt");
    const thinking = await this.read_prompt_enhancement(
      prompt.directory_name,
      context.prompt_language,
    );
    const suffix = await this.read_prompt_text(
      prompt.directory_name,
      context.prompt_language,
      "suffix.txt",
    );
    return this.join_prompt_sections(prefix, base, thinking, suffix)
      .replaceAll("{source_language}", context.source_language)
      .replaceAll("{target_language}", context.target_language)
      .replaceAll(
        "{translation_output_format}",
        build_translation_output_format(mode, context.prompt_language),
      );
  }

  /**
   * 分析主提示词只替换目标语言，不携带源语言占位
   */
  public async build_glossary_analysis_main(): Promise<string> {
    const context = this.resolve_prompt_context();
    const prompt = Prompt.analysis();
    const prefix = await this.read_prompt_text(
      prompt.directory_name,
      context.prompt_language,
      "prefix.txt",
    );
    const base = this.quality_snapshot.analysis_prompt_enable
      ? this.quality_snapshot.analysis_prompt
      : await this.read_prompt_text(prompt.directory_name, context.prompt_language, "base.txt");
    const thinking = await this.read_prompt_enhancement(
      prompt.directory_name,
      context.prompt_language,
    );
    const suffix = await this.read_prompt_text(
      prompt.directory_name,
      context.prompt_language,
      "suffix.txt",
    );
    return this.join_prompt_sections(prefix, base, thinking, suffix).replaceAll(
      "{target_language}",
      context.target_language,
    );
  }

  /**
   * 参考上文只放 user prompt，避免系统指令随上下文变化
   */
  private build_preceding(precedings: TextTaskItemRecord[]): string {
    if (precedings.length === 0) {
      return "";
    }
    const lines = precedings.map((item) =>
      String(item.src ?? "")
        .trim()
        .replaceAll("\n", "\\n"),
    );
    return `${this.t("app.prompt.builder_preceding_context")}\n${lines.join("\n")}`;
  }

  /**
   * runner 已按原始输入激活术语；这里仅保持顺序并格式化提示词。
   */
  private build_glossary(separator: string, include_header = true): string {
    const result = this.activated_glossary_entries.map((entry) =>
      format_glossary_entry(entry).replace(" -> ", separator),
    );
    if (result.length === 0) {
      return "";
    }
    return include_header
      ? `${this.t("app.prompt.builder_glossary_header")}\n${result.join("\n")}`
      : result.join("\n");
  }

  /**
   * 控制字符示例只在系统提示词明确要求控制符时加入
   */
  private build_control_characters_samples(main: string, samples: string[]): string {
    const unique_samples = [...new Set(samples.map((sample) => sample.trim()).filter(Boolean))];
    if (unique_samples.length === 0) {
      return "";
    }
    const main_lower = main.toLowerCase();
    if (
      !(
        main.includes("控制符") ||
        main.includes("控制字符") ||
        main_lower.includes("control code") ||
        main_lower.includes("control character")
      )
    ) {
      return "";
    }
    return `${this.t("app.prompt.builder_control_character_samples")}\n${unique_samples.join(", ")}`;
  }

  /**
   * 翻译输入固定为 jsonline，响应解码器也按此格式优先解析
   */
  private build_inputs(items: TranslationRequestItem[], mode: TranslationPromptMode): string {
    const inputs = items
      .map((item) =>
        JsonTool.stringifyStrict({
          index: item.request_index,
          ...(mode === "actor_text" ? { actor: item.actor_src } : {}),
          text: item.text_src,
        }),
      )
      .join("\n");
    return `${this.t("app.prompt.builder_input")}\n\`\`\`jsonline\n${inputs}\n\`\`\``;
  }

  /**
   * 分析输入保持纯文本，减少模型把 JSON key 当作术语
   */
  private build_analysis_inputs(srcs: string[]): string {
    if (srcs.length === 0) {
      return "";
    }
    return `${this.t("app.prompt.builder_input")}\n${srcs.join("\n")}`;
  }

  /**
   * 模板段落拼接统一在这里处理，保证输出约束始终位于最后
   */
  private join_prompt_sections(
    prefix: string,
    base: string,
    thinking: string,
    suffix: string,
  ): string {
    const parts = [`${prefix}\n${base}`];
    if (thinking !== "") {
      parts.push(thinking);
    }
    parts.push(suffix);
    return parts.join("\n\n");
  }

  /**
   * 转换本地化键为当前语言文本。
   */
  private t(key: LocaleKey, params: Record<string, string> = {}): string {
    return format_i18n_message(resolve_app_locale(this.config.app_language), key, params);
  }

  /**
   * 解析提示词语言、源语言占位和目标语言名
   */
  private resolve_prompt_context(): {
    prompt_language: TranslationPromptLanguage;
    source_language: string;
    target_language: string;
  } {
    const prompt_language = resolve_prompt_template_language(this.config.app_language);
    const display_locale = resolve_language_display_locale(this.config.app_language);
    const source_code = normalize_language_code(String(this.config.source_language));
    const target_code = normalize_language_code(String(this.config.target_language));
    return {
      prompt_language,
      source_language: get_prompt_source_language_name(source_code, display_locale),
      target_language: get_prompt_target_language_name(target_code, display_locale),
    };
  }

  /**
   * 翻译与分析共用同一增强策略；SakuraLLM 不经过此入口。
   */
  private async read_prompt_enhancement(
    task_dir_name: string,
    language: TranslationPromptLanguage,
  ): Promise<string> {
    return this.config.prompt_enhancement_enable
      ? await this.read_prompt_text(task_dir_name, language, "thinking.txt")
      : "";
  }

  /**
   * 模板路径固定在 resource 下，worker 不读用户预设目录
   */
  private async read_prompt_text(
    task_dir_name: string,
    language: TranslationPromptLanguage,
    file_name: string,
  ): Promise<string> {
    const cache_key = `${this.app_root}\u0000${task_dir_name}\u0000${language}\u0000${file_name}`;
    const cached = PromptBuilder.template_cache.get(cache_key);
    if (cached !== undefined) {
      return cached;
    }
    const template_path = path.join(
      this.app_root,
      "resource",
      task_dir_name,
      "template",
      language,
      file_name,
    );
    const text = default_native_fs.read_text_file(template_path).trim();
    PromptBuilder.template_cache.set(cache_key, text);
    return text;
  }
}
