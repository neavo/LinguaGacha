import path from "node:path";
import { readFile } from "node:fs/promises";

import { JsonTool } from "../../../../shared/utils/json-tool";
import type { TextQualitySnapshot, TextTaskItemRecord } from "../../../../shared/text/text-types";
import type { LLMMessage } from "../llm/llm-types";
import { Prompt } from "../../../../base/prompt";
import { format_i18n_message, resolve_i18n_locale, type LocaleKey } from "../../../../shared/i18n";

const SOURCE_PLACEHOLDER_ZH = "原文"; // 中文提示词模板使用“原文”占位，英文模板使用“Source”占位，避免字符串散落在构造逻辑里
const SOURCE_PLACEHOLDER_EN = "Source"; // 英文模板占位符单独保留，避免后续模板本地化时误改中文占位

// 中文 UI 下展示的语言名，直接写入模型提示词
const LANGUAGE_NAME_ZH: Record<string, string> = {
  ZH: "中文",
  EN: "英文",
  JA: "日文",
  KO: "韩文",
  RU: "俄文",
  AR: "阿拉伯文",
  DE: "德文",
  FR: "法文",
  PL: "波兰文",
  ES: "西班牙",
  IT: "意大利文",
  PT: "葡萄牙文",
  HU: "匈牙利文",
  TR: "土耳其文",
  TH: "泰文",
  ID: "印尼文",
  VI: "越南文",
};

// 非中文 UI 下展示的语言名，保持和资源模板英文语境一致
const LANGUAGE_NAME_EN: Record<string, string> = {
  ZH: "Chinese",
  EN: "English",
  JA: "Japanese",
  KO: "Korean",
  RU: "Russian",
  AR: "Arabic",
  DE: "German",
  FR: "French",
  PL: "Polish",
  ES: "Spanish",
  IT: "Italian",
  PT: "Portuguese",
  HU: "Hungarian",
  TR: "Turkish",
  TH: "Thai",
  ID: "Indonesian",
  VI: "Vietnamese",
};

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
    this.app_root = app_root;
    this.config = config;
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
  ): Promise<PromptBuildResult> {
    const messages: LLMMessage[] = [];
    const console_log: string[] = [];
    const instruction_text = await this.build_main();
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

    const inputs = this.build_inputs(srcs);
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
  public async build_main(): Promise<string> {
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
    return this.join_prompt_sections(prefix, base, thinking, suffix)
      .replaceAll("{source_language}", context.source_language)
      .replaceAll("{target_language}", context.target_language);
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
  public build_inputs(srcs: string[]): string {
    const inputs = srcs
      .map((line, index) => JsonTool.stringifyStrict({ [String(index)]: line }))
      .join("\n");
    return `${this.t("app.prompt.builder_input")}\n\`\`\`jsonline\n${inputs}\n\`\`\``;
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
    return String(this.config.app_language ?? "ZH").toUpperCase() === "EN" ? "en" : "zh";
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

  /**
   * 解析提示词语言、源语言占位和目标语言名
   */
  private resolve_prompt_context(): {
    prompt_language: "zh" | "en";
    source_language: string;
    target_language: string;
  } {
    const prompt_language = this.get_prompt_ui_language();
    const source_code = String(this.config.source_language ?? "ALL").toUpperCase();
    const target_code = String(this.config.target_language ?? "ZH").toUpperCase();
    const names = prompt_language === "zh" ? LANGUAGE_NAME_ZH : LANGUAGE_NAME_EN;
    const source_placeholder =
      prompt_language === "zh" ? SOURCE_PLACEHOLDER_ZH : SOURCE_PLACEHOLDER_EN;
    if (target_code === "ALL") {
      throw new Error("target_language does not support ALL");
    }
    if (!(target_code in names)) {
      throw new Error(`invalid target_language: ${target_code}`);
    }
    return {
      prompt_language,
      source_language: names[source_code] ?? source_placeholder,
      target_language: names[target_code] ?? "",
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
    const text = (await readFile(template_path, "utf-8")).trim();
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
