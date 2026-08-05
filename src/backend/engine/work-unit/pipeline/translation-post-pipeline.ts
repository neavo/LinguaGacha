import { CodeFixer } from "../../../../shared/fixer/code-fixer";
import { EscapeFixer } from "../../../../shared/fixer/escape-fixer";
import { HangeulFixer } from "../../../../shared/fixer/hangeul-fixer";
import { KanaFixer } from "../../../../shared/fixer/kana-fixer";
import { NumberFixer } from "../../../../shared/fixer/number-fixer";
import { PunctuationFixer } from "../../../../shared/fixer/punctuation-fixer";
import {
  apply_text_replacements,
  compile_text_replacements,
  type CompiledTextReplacements,
} from "../../../../shared/text/text-replacement-rules";
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
  dst: string; // 恢复格式后的最终正文
  name_dst?: TranslationActor; // actor/text 模式下独立写回的姓名译文
}

/**
 * 翻译译后 pipeline，负责校正模型输出并按译前上下文重建 item 文本
 */
export class TranslationPostPipeline {
  private readonly config: TextProcessingConfig; // 自动修复与语言策略的任务启动快照
  private readonly post_replacements: CompiledTextReplacements | null;

  /**
   * 绑定配置快照和质量快照，确保译后修复与译前规则使用同一批快照
   */
  public constructor(config: TextProcessingConfig, quality_snapshot: TextQualitySnapshot) {
    this.config = config;
    this.post_replacements = quality_snapshot.post_replacement_enable
      ? compile_text_replacements(quality_snapshot.post_replacement_entries)
      : null;
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
    for (const prepared_line of context.prepared_lines) {
      let dst = prepared_line.raw_text;
      if (prepared_line.state === "translatable") {
        dst = (dst_queue.shift() ?? "").trim();
        dst = this.auto_fix(context, prepared_line.raw_text, prepared_line.model_text, dst);
        dst = this.replace_post_translation(dst);
        dst = `${prepared_line.prefix_segments.join("")}${dst}${prepared_line.suffix_segments.join("")}`;
        dst = `${prepared_line.leading_whitespace}${dst}${prepared_line.trailing_whitespace}`;
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
  private auto_fix(
    context: TranslationPrePipelineContext,
    raw_src: string,
    model_src: string,
    dst: string,
  ): string {
    let result = dst;
    if (this.config.source_language === "JA") {
      result = KanaFixer.fix(result);
    } else if (this.config.source_language === "KO") {
      result = HangeulFixer.fix(result);
    }
    // 只有代码修复读取实际模型源文；其余 fixer 保持读取原始源行的既定语义。
    result = CodeFixer.fix(model_src, result, context.preserve_rule);
    result = EscapeFixer.fix(raw_src, result);
    result = NumberFixer.fix(raw_src, result);
    result = PunctuationFixer.fix(
      raw_src,
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
    return this.post_replacements === null
      ? dst
      : apply_text_replacements(dst, this.post_replacements);
  }
}
