import path from "node:path";

import { JsonTool } from "../../../../shared/utils/json-tool";
import type { TextQualitySnapshot, TextTaskItemRecord } from "../../../../shared/text/text-types";
import type { TranslationPromptInput } from "../../../../shared/text/translation-prompt-types";
import type { LLMMessage } from "../../../llm/llm-types";
import { default_native_fs } from "../../../../native/native-fs";
import { Prompt } from "../../../../base/prompt";
import { normalize_setting_snapshot } from "../../../../base/setting";
import { format_i18n_message, resolve_i18n_locale, type LocaleKey } from "../../../../shared/i18n";
import {
  get_language_display_locale,
  get_prompt_source_language_name,
  get_prompt_target_language_name,
  normalize_language_code,
} from "../../../../shared/language";

/**
 * 提示词构造所需的最小配置快照，worker 只读取语言与界面语言
 */
export interface PromptBuilderConfig {
  app_language?: string;
  source_language?: string;
  target_language?: string;
}

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

  /**
   * app_root 由 Electron main 注入，worker 不自行猜测资源根
   */
  public constructor(
    app_root: string,
    config: PromptBuilderConfig,
    quality_snapshot: TextQualitySnapshot,
  ) {
    const setting_snapshot = normalize_setting_snapshot(config);
    this.app_root = app_root;
    this.config = {
      app_language: setting_snapshot.app_language,
      source_language: setting_snapshot.source_language,
      target_language: setting_snapshot.target_language,
    };
    this.quality_snapshot = quality_snapshot;
  }

  /**
   * 清空模板缓存，测试和资源热更新后可重新读取磁盘内容
   */
  public static reset(): void {
    this.template_cache.clear();
  }

  /**
   * 生成普通翻译提示词；system 放稳定指令，user 放本次输入和术语
   */
  public async generate_prompt(
    srcs: string[],
    samples: string[],
    precedings: TextTaskItemRecord[],
  ): Promise<PromptBuildResult>;
  public async generate_prompt(
    prompt_inputs: TranslationPromptInput[],
    samples: string[],
    precedings: TextTaskItemRecord[],
    use_structured_speaker_context: boolean,
  ): Promise<PromptBuildResult>;
  public async generate_prompt(
    inputs: Array<string | TranslationPromptInput>,
    samples: string[],
    precedings: TextTaskItemRecord[],
    use_structured_speaker_context = false,
  ): Promise<PromptBuildResult> {
    const prompt_inputs = this.normalize_prompt_inputs(inputs);
    const messages: LLMMessage[] = [];
    const console_log: string[] = [];
    const instruction_text = await this.build_main(use_structured_speaker_context);
    const srcs = prompt_inputs.map((item) => item.text);
    const user_parts: string[] = [];

    const preceding = this.build_preceding(precedings);
    if (preceding !== "") {
      user_parts.push(preceding);
      console_log.push(preceding);
    }

    if (this.quality_snapshot.glossary_enable) {
      const glossary = this.build_glossary(srcs);
      if (glossary !== "") {
        user_parts.push(glossary);
        console_log.push(glossary);
      }
    }

    const control_samples = this.build_control_characters_samples(instruction_text, samples);
    if (control_samples !== "") {
      user_parts.push(control_samples);
      console_log.push(control_samples);
    }

    const input_text = this.build_inputs(prompt_inputs, use_structured_speaker_context);
    if (input_text !== "") {
      user_parts.push(input_text);
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
    if (this.quality_snapshot.glossary_enable) {
      const glossary = this.build_glossary_sakura(srcs);
      if (glossary !== "") {
        content = `根据以下术语表（可以为空）：\n${glossary}\n将下面的日文文本根据对应关系和备注翻译成中文：\n${srcs.join("\n")}`;
        console_log.push(glossary);
      }
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
  public async build_main(): Promise<string>;
  public async build_main(use_structured_speaker_context: boolean): Promise<string>;
  public async build_main(use_structured_speaker_context = false): Promise<string> {
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
    const thinking = await this.read_prompt_text(
      prompt.directory_name,
      context.prompt_language,
      "thinking.txt",
    );
    const suffix = await this.read_prompt_text(
      prompt.directory_name,
      context.prompt_language,
      "suffix.txt",
    );
    const resolved_suffix = use_structured_speaker_context
      ? this.strip_translation_output_examples(suffix)
      : suffix;
    const structured_suffix = use_structured_speaker_context
      ? `${this.build_structured_output_format_instruction()}`
      : "";
    return `${this.join_prompt_sections(prefix, base, thinking, resolved_suffix)
      .replaceAll("{source_language}", context.source_language)
      .replaceAll(
        "{target_language}",
        context.target_language,
      )}${structured_suffix === "" ? "" : `\n\n${structured_suffix}`}`;
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
    const thinking = await this.read_prompt_text(
      prompt.directory_name,
      context.prompt_language,
      "thinking.txt",
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
  public build_preceding(precedings: TextTaskItemRecord[]): string {
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
   * 术语表按当前输入全文命中过滤，未命中时不污染 prompt
   */
  public build_glossary(srcs: string[]): string {
    const result = this.build_glossary_lines(srcs, " -> ");
    if (result.length === 0) {
      return "";
    }
    return `${this.t("app.prompt.builder_glossary_header")}\n${result.join("\n")}`;
  }

  /**
   * SakuraLLM 术语格式不带空格，保持旧提示词格式
   */
  public build_glossary_sakura(srcs: string[]): string {
    return this.build_glossary_lines(srcs, "->").join("\n");
  }

  /**
   * 控制字符示例只在系统提示词明确要求控制符时加入
   */
  public build_control_characters_samples(main: string, samples: string[]): string {
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
  public build_inputs(srcs: string[]): string;
  public build_inputs(
    prompt_inputs: TranslationPromptInput[],
    use_structured_speaker_context: boolean,
  ): string;
  public build_inputs(
    inputs: Array<string | TranslationPromptInput>,
    use_structured_speaker_context = false,
  ): string {
    const prompt_inputs = this.normalize_prompt_inputs(inputs);
    const input_lines = prompt_inputs
      .map((input, index) =>
        use_structured_speaker_context
          ? JsonTool.stringifyStrict({
              [String(index)]: {
                speaker: input.speaker,
                text: input.text,
              },
            })
          : JsonTool.stringifyStrict({ [String(index)]: input.text }),
      )
      .join("\n");
    return `${this.t("app.prompt.builder_input")}\n\`\`\`jsonline\n${input_lines}\n\`\`\``;
  }

  /**
   * 分析输入保持纯文本，减少模型把 JSON key 当作术语
   */
  public build_analysis_inputs(srcs: string[]): string {
    if (srcs.length === 0) {
      return "";
    }
    return `${this.t("app.prompt.builder_input")}\n${srcs.join("\n")}`;
  }

  /**
   * 模板段落拼接统一在这里处理，保证输出约束始终位于最后
   */
  public join_prompt_sections(
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
   * UI 语言只支持中英提示词模板，未知值回退中文
   */
  private get_prompt_ui_language(): "zh" | "en" {
    return this.config.app_language === "EN" ? "en" : "zh";
  }

  /**
   * 中文 UI 决定提示词标题和语言名显示口径
   */
  private is_prompt_ui_zh(): boolean {
    return this.get_prompt_ui_language() === "zh";
  }

  private t(key: LocaleKey, params: Record<string, string> = {}): string {
    return format_i18n_message(resolve_i18n_locale(this.config.app_language), key, params);
  }

  private normalize_prompt_inputs(
    inputs: Array<string | TranslationPromptInput>,
  ): TranslationPromptInput[] {
    return inputs.map((input) =>
      typeof input === "string" ? { speaker: null, text: input } : input,
    );
  }

  /**
   * 结构化 speaker 模式使用单独的输出格式说明，避免旧 JSONLINE 示例误导模型
   */
  private build_structured_output_format_instruction(): string {
    if (this.is_prompt_ui_zh()) {
      return [
        "然后使用JSONLINE输出翻译结果，无需额外说明或解释：",
        "```jsonline",
        '{"<序号>":{"speaker_translation":"<说话人译文>","text":"<译文文本>"}}',
        "```",
      ].join("\n");
    }
    return [
      "Then use JSONLINE to output translation results, without extra explanation or clarification:",
      "```jsonline",
      '{"<INDEX>":{"speaker_translation":"<Speaker Translation>","text":"<Translated Text>"}}',
      "```",
    ].join("\n");
  }

  /**
   * 结构化模式下移除 suffix 里历史旧输出示例，只保留语义句子
   */
  private strip_translation_output_examples(suffix: string): string {
    return suffix
      .replace(
        /(?:然后使用JSONLINE输出翻译结果，无需额外说明或解释：|Then use JSONLINE to output translation results, without extra explanation or clarification:)\s*\r?\n```jsonline[\s\S]*?```\s*$/u,
        "",
      )
      .trim();
  }

  /**
   * 解析提示词语言、源语言占位和目标语言名
   */
  private resolve_prompt_context(): {
    prompt_language: "zh" | "en";
    source_language: string;
    target_language: string;
  } {
    const prompt_language = this.get_prompt_ui_language();
    const display_locale = get_language_display_locale(this.config.app_language);
    const source_code = normalize_language_code(String(this.config.source_language));
    const target_code = normalize_language_code(String(this.config.target_language));
    return {
      prompt_language,
      source_language: get_prompt_source_language_name(source_code, display_locale),
      target_language: get_prompt_target_language_name(target_code, display_locale),
    };
  }

  /**
   * 模板路径固定在 resource 下，worker 不读用户预设目录
   */
  private async read_prompt_text(
    task_dir_name: string,
    language: "zh" | "en",
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

  /**
   * 术语匹配尊重大小写标志，命中后按指定分隔符生成行文本
   */
  private build_glossary_lines(srcs: string[], separator: string): string[] {
    const full_text = srcs.join("\n");
    const full_text_lower = full_text.toLowerCase();
    const result: string[] = [];
    for (const entry of this.quality_snapshot.glossary_entries) {
      const src = String(entry["src"] ?? "");
      const dst = String(entry["dst"] ?? "");
      const info = String(entry["info"] ?? "");
      const case_sensitive = entry["case_sensitive"] === true;
      const matched = case_sensitive
        ? full_text.includes(src)
        : full_text_lower.includes(src.toLowerCase());
      if (!matched) {
        continue;
      }
      result.push(info === "" ? `${src}${separator}${dst}` : `${src}${separator}${dst} #${info}`);
    }
    return result;
  }
}
