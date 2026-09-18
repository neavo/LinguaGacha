import {
  apply_text_replacements,
  compile_text_replacements,
  type CompiledTextReplacements,
} from "../../../../shared/text/text-replacement-rules";
import type { TextProcessingConfig, TextQualitySnapshot } from "../../../../shared/text/text-types";
import { split_text_lines } from "../../../../shared/text/text-lines";
import {
  normalize_translation_actor,
  type TranslationDecodedItem,
  type TranslationPromptMode,
} from "../translation-item";
import type { TranslationPrePipelineContext } from "./translation-pre-pipeline";
import { restore_translation_line } from "./translation-output-restoration";
import {
  restore_text_resource_references,
  transform_projected_text_resource_references,
  type TextResourceReferenceMapping,
} from "../../../../shared/text/text-resource-reference";

/** 逐行恢复后的正文与可选姓名，交给调用方写回条目。 */
export interface TranslationPostPipelineResult {
  dst: string; // 行数不对应时保留模型返回的完整正文。
  name_dst?: string | null; // 请求包含姓名时才返回该字段。
}

/** 行数对应时恢复源文结构，并执行译后替换和资源引用还原。 */
export class TranslationPostPipeline {
  private readonly post_replacements: CompiledTextReplacements | null;
  /** 本轮译后替换规则只编译一次。 */
  public constructor(
    private readonly config: TextProcessingConfig,
    quality_snapshot: TextQualitySnapshot,
  ) {
    this.post_replacements = quality_snapshot.post_replacement_enable
      ? compile_text_replacements(quality_snapshot.post_replacement_entries)
      : null;
  }

  /** 模型响应按行对应恢复依据，姓名按请求是否包含姓名决定写回。 */
  public process_item(
    context: TranslationPrePipelineContext,
    decoded_item: TranslationDecodedItem,
    mode: TranslationPromptMode,
  ): TranslationPostPipelineResult {
    const output_lines = split_text_lines(decoded_item.text_dst);
    const corresponding = output_lines.length === context.prepared_lines.length; // 行数一致才有逐行恢复依据。
    const projected_dst = corresponding
      ? context.prepared_lines
          .map((prepared_line, index) => {
            if (prepared_line.state === "preserved") return prepared_line.prepared_text;
            let line = restore_translation_line({
              restoration_text: prepared_line.restoration_text,
              prepared_text: prepared_line.prepared_text,
              translation: (output_lines[index] ?? "").trim(),
              preserve_rule: context.preserve_rule,
              source_language: this.config.source_language,
              target_language: this.config.target_language,
            });
            line = this.replace_post_translation(line, context.reference_mappings);
            return `${prepared_line.leading_whitespace}${line}${prepared_line.trailing_whitespace}`;
          })
          .join("\n")
      : output_lines
          .map((line) => this.replace_post_translation(line, context.reference_mappings))
          .join("\n");
    const dst = restore_text_resource_references(projected_dst, context.reference_mappings);
    if (mode !== "actor_text" || context.request_item?.actor_src === null) return { dst };
    const normalized_actor = normalize_translation_actor(decoded_item.actor_dst);
    return {
      dst,
      name_dst:
        normalized_actor === null
          ? null
          : restore_text_resource_references(normalized_actor, context.actor_reference_mappings),
    };
  }

  /** 替换只作用于普通文本，临时资源引用由映射单独恢复。 */
  private replace_post_translation(
    dst: string,
    reference_mappings: readonly TextResourceReferenceMapping[],
  ): string {
    const post_replacements = this.post_replacements;
    return post_replacements === null
      ? dst
      : transform_projected_text_resource_references(dst, reference_mappings, (value) =>
          apply_text_replacements(value, post_replacements),
        );
  }
}
