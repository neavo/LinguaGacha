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

/** Public item writeback produced after deterministic restoration stages. */
export interface TranslationPostPipelineResult {
  dst: string; // Restored item body; its line count may follow the model on mismatch.
  name_dst?: string | null; // Present only when the source item carried an actor name.
}

/** Restores deterministic source structure when the model preserves item line count. */
export class TranslationPostPipeline {
  private readonly post_replacements: CompiledTextReplacements | null;
  /** Freezes post-replacement rules for the current task run. */
  public constructor(
    private readonly config: TextProcessingConfig,
    quality_snapshot: TextQualitySnapshot,
  ) {
    this.post_replacements = quality_snapshot.post_replacement_enable
      ? compile_text_replacements(quality_snapshot.post_replacement_entries)
      : null;
  }

  /** Applies model output to one item and restores protected source structure. */
  public process_item(
    context: TranslationPrePipelineContext,
    decoded_item: TranslationDecodedItem,
    mode: TranslationPromptMode,
  ): TranslationPostPipelineResult {
    if (context.item === null) return { dst: "" };
    const output_lines = split_text_lines(decoded_item.text_dst);
    const corresponding = output_lines.length === context.prepared_lines.length;
    const projected_dst = corresponding
      ? context.prepared_lines
          .map((prepared_line, index) => {
            if (prepared_line.state === "preserved") return prepared_line.raw_text;
            let line = restore_translation_line({
              restoration_text: prepared_line.restoration_text,
              model_text: prepared_line.model_text,
              translation: (output_lines[index] ?? "").trim(),
              preserve_rule: context.preserve_rule,
              source_language: this.config.source_language,
              target_language: this.config.target_language,
            });
            line = this.replace_post_translation(line, context.reference_mappings);
            return `${prepared_line.leading_whitespace}${prepared_line.prefix_segments.join("")}${line}${prepared_line.suffix_segments.join("")}${prepared_line.trailing_whitespace}`;
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

  /** Applies the compiled post-translation replacement snapshot. */
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
