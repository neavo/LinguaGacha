import { CodeFixer } from "../../../../shared/fixer/code-fixer";
import { EscapeFixer } from "../../../../shared/fixer/escape-fixer";
import { HangeulFixer } from "../../../../shared/fixer/hangeul-fixer";
import { KanaFixer } from "../../../../shared/fixer/kana-fixer";
import { NumberFixer } from "../../../../shared/fixer/number-fixer";
import { PunctuationFixer } from "../../../../shared/fixer/punctuation-fixer";
import { extract_text_name_prefix } from "../../../../shared/text/text-name-prefix";
import { build_text_preserve_rule } from "../../../../shared/text/text-preserve-rules";
import { apply_text_replacements } from "../../../../shared/text/text-replacement-rules";
import type { TextProcessingConfig, TextQualitySnapshot } from "../../../../shared/text/text-types";
import type { TranslationPrePipelineContext } from "./translation-pre-pipeline";

/**
 * 翻译译后流程输出，包含可回写正文和可选译后姓名
 */
export interface TranslationPostPipelineResult {
  name: string | null;
  dst: string;
}

/**
 * 翻译译后 pipeline，负责校正模型输出并按译前上下文重建 item 文本
 */
export class TranslationPostPipeline {
  private readonly config: TextProcessingConfig;
  private readonly quality_snapshot: TextQualitySnapshot;

  /**
   * 绑定配置快照和质量快照，确保译后修复与译前规则使用同一批快照
   */
  public constructor(config: TextProcessingConfig, quality_snapshot: TextQualitySnapshot) {
    this.config = config;
    this.quality_snapshot = quality_snapshot;
  }

  /**
   * 按镜像顺序恢复保护段、执行修复和替换，并回写原始空白
   */
  public process_item(
    context: TranslationPrePipelineContext,
    dsts: string[],
  ): TranslationPostPipelineResult {
    if (context.item === null) {
      return { name: null, dst: "" };
    }
    const dst_queue = [...dsts];
    const extracted = this.extract_name(context, dst_queue);
    const results: string[] = [];
    for (const [line_index, src] of context.source_text.split("\n").entries()) {
      let dst: string;
      if (src === "") {
        dst = "";
      } else if (src.trim() === "" || !context.valid_line_indexes.has(line_index)) {
        dst = src;
      } else {
        dst = (extracted.dsts.shift() ?? "").trim();
        dst = this.auto_fix(context, src, dst);
        dst = this.replace_post_translation(dst);
        const prefix_codes = context.prefix_codes_by_line.get(line_index) ?? [];
        const suffix_codes = context.suffix_codes_by_line.get(line_index) ?? [];
        dst = `${prefix_codes.join("")}${dst}${suffix_codes.join("")}`;
        dst = `${context.leading_whitespace_by_line.get(line_index) ?? ""}${dst}${
          context.trailing_whitespace_by_line.get(line_index) ?? ""
        }`;
      }
      results.push(dst);
    }
    return { name: extracted.name, dst: results.join("\n") };
  }

  /**
   * 姓名提取只在源 item 确实带 name_src 时启用，避免误吃普通括号文本
   */
  private extract_name(
    context: TranslationPrePipelineContext,
    dsts: string[],
  ): { name: string | null; dsts: string[] } {
    if (!this.has_source_name(context)) {
      return { name: null, dsts };
    }
    const extracted = extract_text_name_prefix(dsts[0] ?? "");
    if (extracted.name === null) {
      return { name: null, dsts };
    }
    dsts[0] = extracted.text;
    return { name: extracted.name, dsts };
  }

  /**
   * 自动修复顺序必须保持：语言残留、代码、转义、数字、标点
   */
  private auto_fix(context: TranslationPrePipelineContext, src: string, dst: string): string {
    let result = dst;
    if (this.config.source_language === "JA") {
      result = KanaFixer.fix(result);
    } else if (this.config.source_language === "KO") {
      result = HangeulFixer.fix(result);
    }
    result = CodeFixer.fix(src, result, this.get_re_sample(context));
    result = EscapeFixer.fix(src, result);
    result = NumberFixer.fix(src, result);
    result = PunctuationFixer.fix(
      src,
      result,
      this.config.source_language,
      this.config.target_language,
    );
    return result;
  }

  /**
   * 译后替换和译前替换共享同一组 regex / literal 语义
   */
  private replace_post_translation(dst: string): string {
    if (!this.quality_snapshot.post_replacement_enable) {
      return dst;
    }
    return apply_text_replacements(dst, this.quality_snapshot.post_replacement_entries);
  }

  /**
   * 判断当前 item 是否带源姓名，数组字段只要存在一个非空姓名即启用提取
   */
  private has_source_name(context: TranslationPrePipelineContext): boolean {
    const item = context.item;
    if (item === null) {
      return false;
    }
    const name_src = item.name_src;
    if (typeof name_src === "string") {
      return name_src !== "";
    }
    return (
      Array.isArray(name_src) && name_src.some((name) => typeof name === "string" && name !== "")
    );
  }

  /**
   * 样例规则用于代码修复，必须和译前样例收集使用同一条规则
   */
  private get_re_sample(context: TranslationPrePipelineContext): RegExp | null {
    return build_text_preserve_rule({
      mode: this.quality_snapshot.text_preserve_mode,
      text_type: this.read_text_type(context),
      entries: this.quality_snapshot.text_preserve_entries,
      kind: "sample",
    });
  }

  /**
   * item 文本类型缺失时按 TXT 处理，避免代码修复读取空规则
   */
  private read_text_type(context: TranslationPrePipelineContext): string {
    return String(context.item?.text_type ?? "TXT").toUpperCase();
  }
}
