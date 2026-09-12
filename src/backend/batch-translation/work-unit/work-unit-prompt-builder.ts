import path from "node:path";

import { JsonTool } from "../../../shared/utils/json-tool";
import {
  build_translation_output_format,
  type TranslationPromptLanguage,
} from "../../../shared/text/translation-output-format";
import type { TextQualitySnapshot, TextTaskItemRecord } from "../../../shared/text/text-types";
import type { LLMMessage } from "../../llm/llm-types";
import { default_native_fs } from "../../../native/native-fs";
import { TRANSLATION_PROMPT } from "../../../domain/prompt";
import { normalize_setting_snapshot, type SettingSnapshot } from "../../../domain/setting";
import { resolve_prompt_template_language } from "../../../domain/app-language";
import { AppError } from "../../../shared/error";
import { format_i18n_message, type LocaleKey } from "../../../shared/i18n";
import { normalize_language_code } from "../../../domain/language";
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
  private static readonly template_cache = new Map<string, string>(); // 按资产根和模板身份复用只读文本

  private readonly builtin_root: string; // 当前版本提示词模板根
  private readonly config: PromptBuilderConfig; // 本轮冻结的语言与增强开关
  private readonly quality_snapshot: TextQualitySnapshot; // 工程自定义翻译规则快照
  private readonly activated_glossary_entries: readonly GlossaryEntry[]; // runner 已按原文完成激活

  /**
   * builtin_root 由入口注入，worker 不自行猜测内置资产根
   */
  public constructor(
    builtin_root: string,
    config: Partial<PromptBuilderConfig>,
    quality_snapshot: TextQualitySnapshot,
    activated_glossary_entries: readonly GlossaryEntry[],
  ) {
    const setting_snapshot = normalize_setting_snapshot(config);
    this.builtin_root = builtin_root;
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
  public generate_prompt(
    items: TranslationRequestItem[],
    mode: TranslationPromptMode,
    samples: string[],
    precedings: TextTaskItemRecord[],
  ): PromptBuildResult {
    const messages: LLMMessage[] = [];
    const console_log: string[] = [];
    const instruction_text = this.build_main(mode);
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

    user_parts.push(this.build_inputs(items, mode));

    messages.push({ role: "system", content: instruction_text });
    messages.push({ role: "user", content: user_parts.join("\n\n") });
    return { messages, console_log };
  }

  /** 构建单个 SakuraLLM item 使用的纯文本提示词。 */
  public generate_prompt_sakura(src: string): PromptBuildResult {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content:
          "你是一个轻小说翻译模型，可以流畅通顺地以日本轻小说的风格将日文翻译成简体中文，并联系上下文正确使用人称代词，不擅自添加原文中没有的代词。",
      },
    ];
    const console_log: string[] = [];
    let content = `将下面的日文文本翻译成中文：\n${src}`;
    const glossary = this.build_glossary("->", false);
    if (glossary !== "") {
      content = `根据以下术语表（可以为空）：\n${glossary}\n将下面的日文文本根据对应关系和备注翻译成中文：\n${src}`;
      console_log.push(glossary);
    }
    messages.push({ role: "user", content });
    return { messages, console_log };
  }

  /**
   * 翻译主提示词从自定义快照或资源模板读取
   */
  public build_main(mode: TranslationPromptMode = "text"): string {
    const context = this.resolve_prompt_context();
    const prefix = this.read_prompt_text(context.prompt_language, "prefix.txt");
    const base = this.quality_snapshot.translation_prompt_enable
      ? this.quality_snapshot.translation_prompt
      : this.read_prompt_text(context.prompt_language, "base.txt");
    const enhancement = this.config.prompt_enhancement_enable
      ? this.read_prompt_text(context.prompt_language, "thinking.txt")
      : "";
    const suffix = this.read_prompt_text(context.prompt_language, "suffix.txt");
    const sections = [`${prefix}\n${base}`];
    if (enhancement !== "") sections.push(enhancement);
    // 自定义规则和增强段共用最后的输出约束。
    sections.push(suffix);
    return sections
      .join("\n\n")
      .replaceAll("{source_language}", context.source_language)
      .replaceAll("{target_language}", context.target_language)
      .replaceAll(
        "{translation_output_format}",
        build_translation_output_format(mode, context.prompt_language),
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
          id: item.request_id,
          ...(mode === "actor_text" ? { actor: item.actor_src } : {}),
          text: item.text_src,
        }),
      )
      .join("\n");
    return `${this.t("app.prompt.builder_input")}\n\`\`\`jsonline\n${inputs}\n\`\`\``;
  }

  /**
   * 模型输入说明及其日志回显使用模板语言，避免同一次请求混用 UI 语言。
   */
  private t(key: LocaleKey): string {
    const locale =
      resolve_prompt_template_language(this.config.app_language) === "zh" ? "zh-CN" : "en-US";
    return format_i18n_message(locale, key);
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
    const source_code = normalize_language_code(this.config.source_language);
    const target_code = normalize_language_code(this.config.target_language);
    if (target_code === "ALL") {
      throw new AppError("language.unsupported_all_target_language");
    }
    if (target_code === null) {
      throw new AppError("language.invalid_target_language");
    }
    return {
      prompt_language,
      source_language: this.t(
        source_code === null || source_code === "ALL"
          ? "app.prompt.source"
          : `app.language.${source_code}`,
      ),
      target_language: this.t(`app.language.${target_code}`),
    };
  }

  /**
   * worker 同步读取内置模板，按完整路径隔离不同资产根的缓存。
   */
  private read_prompt_text(language: TranslationPromptLanguage, file_name: string): string {
    const template_path = path.join(
      this.builtin_root,
      TRANSLATION_PROMPT.directory_name,
      "template",
      language,
      file_name,
    );
    const cached = PromptBuilder.template_cache.get(template_path);
    if (cached !== undefined) return cached;
    const text = default_native_fs.read_text_file(template_path).trim();
    PromptBuilder.template_cache.set(template_path, text);
    return text;
  }
}
