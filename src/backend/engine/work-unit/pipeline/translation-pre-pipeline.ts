import { TextRubyCleaner } from "../../../../shared/text/text-ruby-cleaner";
import { normalize_text_for_processing } from "../../../../shared/text/text-normalizer";
import {
  build_text_preserve_rule,
  type TextPreserveRule,
} from "../../../../shared/text/text-preserve-rules";
import {
  apply_text_replacements,
  compile_text_replacements,
  type CompiledTextReplacements,
} from "../../../../shared/text/text-replacement-rules";
import type {
  TextProcessingConfig,
  TextQualitySnapshot,
  TextTaskItemRecord,
} from "../../../../shared/text/text-types";
import { read_optional_item_name_text } from "../../../../shared/item-name";
import type { TranslationLine } from "../translation-line";

/**
 * 翻译译前流程产物，显式保存译后恢复需要的每行状态
 */
export interface TranslationPrePipelineContext {
  item: TextTaskItemRecord | null; // 保留当前 work unit 的可写快照，译后流程只回写这份对象
  source_text: string; // 直接来自 item.src，格式结构组装必须在导入边界完成
  lines: TranslationLine[]; // 真正送入模型的行，空行和完全保护行不会进入请求
  samples: string[]; // 收集保护段示例，供 PromptBuilder 判断是否补控制字符说明
  valid_line_indexes: Set<number>; // 记录送入模型的源行位置，译后只按这些行回填
  prefix_codes_by_line: Map<number, string[]>; // 按行保存前缀保护码，恢复时保持原始左侧位置
  suffix_codes_by_line: Map<number, string[]>; // 单独保存后缀保护码，避免恢复时改变原始右侧顺序
  leading_whitespace_by_line: Map<number, string>; // 记录行首空白，避免模型输出破坏原文件排版
  trailing_whitespace_by_line: Map<number, string>; // 记录行尾空白，保留脚本行末格式
  preserve_rule: TextPreserveRule | null; // 同一 item 的保护能力只编译一次并交给译后流程
}

/**
 * 翻译译前 pipeline，负责把 item 源文本转换成模型输入和显式恢复上下文
 */
export class TranslationPrePipeline {
  private readonly config: TextProcessingConfig; // 语言与文本修复策略的任务启动快照
  private readonly quality_snapshot: TextQualitySnapshot; // 保护与译前替换规则的同轮快照
  private readonly pre_replacements: CompiledTextReplacements | null;

  /**
   * 绑定配置快照和质量快照，pipeline 不读取全局会话缓存
   */
  public constructor(config: TextProcessingConfig, quality_snapshot: TextQualitySnapshot) {
    this.config = config;
    this.quality_snapshot = quality_snapshot;
    this.pre_replacements = quality_snapshot.pre_replacement_enable
      ? compile_text_replacements(quality_snapshot.pre_replacement_entries)
      : null;
  }

  /**
   * 按固定顺序执行：读取 item.src、归一化、纯文本 ruby、保护、替换
   */
  public process_item(
    item: TextTaskItemRecord | null,
    item_index = 0,
    request_index_start = 0,
  ): TranslationPrePipelineContext {
    const context = this.create_empty_context(item);
    if (item === null) {
      return context;
    }
    const text_type = String(item.text_type ?? "TXT").toUpperCase();
    context.preserve_rule = build_text_preserve_rule({
      mode: this.quality_snapshot.text_preserve_mode,
      text_type,
      entries: this.quality_snapshot.text_preserve_entries,
    });
    const actor_src = read_optional_item_name_text(item.name_src);
    context.source_text = String(item.src ?? "");
    for (const [line_index, raw_src] of context.source_text.split("\n").entries()) {
      let src = normalize_text_for_processing(raw_src);
      src = this.clean_ruby(src, text_type);
      if (src === "" || src.trim() === "") {
        continue;
      }
      src = this.extract_line_edge_whitespace(context, line_index, src);
      src = this.prefix_suffix_process(context, line_index, src);
      if (src === "") {
        continue;
      }
      if (
        !this.config.auto_process_prefix_suffix_preserved_text &&
        this.is_fully_preserved_line(src, context.preserve_rule)
      ) {
        continue;
      }
      src = this.replace_pre_translation(src);
      this.collect_samples(context, src, text_type);
      context.lines.push({
        request_index: request_index_start + context.lines.length,
        item_index,
        line_index,
        text_src: src,
        actor_src,
      });
      context.valid_line_indexes.add(line_index);
    }
    return context;
  }

  /**
   * 创建空上下文，保证无 item 和空 item 分支也返回同一形状
   */
  private create_empty_context(item: TextTaskItemRecord | null): TranslationPrePipelineContext {
    return {
      item,
      source_text: "",
      lines: [],
      samples: [],
      valid_line_indexes: new Set<number>(),
      prefix_codes_by_line: new Map<number, string[]>(),
      suffix_codes_by_line: new Map<number, string[]>(),
      leading_whitespace_by_line: new Map<number, string>(),
      trailing_whitespace_by_line: new Map<number, string>(),
      preserve_rule: null,
    };
  }

  /**
   * clean_ruby 只控制字面文本标记，EPUB DOM ruby 不进入 worker 层
   */
  private clean_ruby(src: string, text_type: string): string {
    return this.config.clean_ruby ? TextRubyCleaner.clean(src, text_type) : src;
  }

  /**
   * 记录每行原始头尾空白，并返回可参与翻译的正文
   */
  private extract_line_edge_whitespace(
    context: TranslationPrePipelineContext,
    line_index: number,
    src: string,
  ): string {
    const leading_match = src.match(/^\s*/u);
    const trailing_match = src.match(/\s*$/u);
    const leading = leading_match?.[0] ?? "";
    const trailing = trailing_match?.[0] ?? "";
    context.leading_whitespace_by_line.set(line_index, leading);
    context.trailing_whitespace_by_line.set(line_index, trailing);
    return src.slice(leading.length, src.length - trailing.length);
  }

  /**
   * 按规则提取前后缀保护段，提取结果在译后流程末尾恢复
   */
  private prefix_suffix_process(
    context: TranslationPrePipelineContext,
    line_index: number,
    src: string,
  ): string {
    if (!this.config.auto_process_prefix_suffix_preserved_text) {
      return src;
    }
    let result = src;
    if (context.preserve_rule !== null) {
      const extracted = context.preserve_rule.extract_prefix(result);
      result = extracted.text;
      context.prefix_codes_by_line.set(line_index, extracted.segments);
    }
    if (context.preserve_rule !== null) {
      const extracted = context.preserve_rule.extract_suffix(result);
      result = extracted.text;
      context.suffix_codes_by_line.set(line_index, extracted.segments);
    }
    return result;
  }

  /**
   * 完全保护行不能送给模型，否则会把代码段翻译成自然语言
   */
  private is_fully_preserved_line(src: string, rule: TextPreserveRule | null): boolean {
    return rule?.matches_entire_text(src) ?? false;
  }

  /**
   * 译前替换只消费质量快照
   */
  private replace_pre_translation(src: string): string {
    return this.pre_replacements === null
      ? src
      : apply_text_replacements(src, this.pre_replacements);
  }

  /**
   * 收集控制字符示例，Markdown 额外注入固定代码示例
   */
  private collect_samples(
    context: TranslationPrePipelineContext,
    src: string,
    text_type: string,
  ): void {
    if (context.preserve_rule !== null) {
      context.samples.push(...context.preserve_rule.collect(src));
    }
    if (text_type === "MD") {
      context.samples.push("Markdown Code");
    }
  }
}
