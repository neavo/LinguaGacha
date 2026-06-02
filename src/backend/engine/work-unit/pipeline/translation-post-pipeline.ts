import { CodeFixer } from "../../../../shared/fixer/code-fixer";
import { EscapeFixer } from "../../../../shared/fixer/escape-fixer";
import { HangeulFixer } from "../../../../shared/fixer/hangeul-fixer";
import { KanaFixer } from "../../../../shared/fixer/kana-fixer";
import { NumberFixer } from "../../../../shared/fixer/number-fixer";
import { PunctuationFixer } from "../../../../shared/fixer/punctuation-fixer";
import {
  build_text_preserve_rule,
  type TextPreserveRule,
} from "../../../../shared/text/text-preserve-rules";
import { apply_text_replacements } from "../../../../shared/text/text-replacement-rules";
import type { TextProcessingConfig, TextQualitySnapshot } from "../../../../shared/text/text-types";
import {
  normalize_translation_actor,
  type TranslationActor,
  type TranslationDecodedLine,
  type TranslationPromptMode,
} from "../translation-line";
import type { TranslationPrePipelineContext } from "./translation-pre-pipeline";

/**
 * 译后 pipeline 的公开产物，name_dst 只有 actor/text 模式参与写回。
 */
export interface TranslationPostPipelineResult {
  dst: string;
  name_dst?: TranslationActor;
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
    decoded_lines: TranslationDecodedLine[],
    mode: TranslationPromptMode,
  ): TranslationPostPipelineResult {
    if (context.item === null) {
      return { dst: "" };
    }
    const dst_queue = decoded_lines.map((line) => line.text_dst);
    const results: string[] = [];
    for (const [line_index, src] of context.source_text.split("\n").entries()) {
      let dst: string;
      if (src === "") {
        dst = "";
      } else if (src.trim() === "" || !context.valid_line_indexes.has(line_index)) {
        dst = src;
      } else {
        dst = (dst_queue.shift() ?? "").trim();
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
    const dst = results.join("\n");
    if (mode === "text") {
      return { dst };
    }
    const name_dst = this.read_name_dst(context, decoded_lines);
    return name_dst === undefined ? { dst } : { dst, name_dst };
  }

  /**
   * 同一个 item 多行都返回姓名时，只从源行带姓名的输出中取第一条有效译名写回。
   * 没有源姓名行时不产生字段，避免把“未参与姓名翻译”误当成清空译名。
   */
  private read_name_dst(
    context: TranslationPrePipelineContext,
    decoded_lines: TranslationDecodedLine[],
  ): TranslationActor | undefined {
    const actor_src_by_request_index = new Map(
      context.lines.map((line) => [line.request_index, line.actor_src]),
    );
    let has_actor_src = false;
    for (const line of decoded_lines) {
      if ((actor_src_by_request_index.get(line.request_index) ?? null) === null) {
        continue;
      }
      has_actor_src = true;
      const actor = normalize_translation_actor(line.actor_dst);
      if (actor !== null) {
        return actor;
      }
    }
    return has_actor_src ? null : undefined;
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
   * 样例规则用于代码修复，必须和译前样例收集使用同一条规则
   */
  private get_re_sample(context: TranslationPrePipelineContext): TextPreserveRule | null {
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
