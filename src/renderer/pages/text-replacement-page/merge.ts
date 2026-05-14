import type { TextReplacementEntry } from "@/pages/text-replacement-page/types";
import {
  QualityRuleMergeModeValue,
  QualityRuleMergeRuleTypeValue,
  merge_quality_rule_entries,
} from "@shared/quality/merger";

type TextReplacementMergeReport = {
  added: number;
  updated: number;
  deduped: number;
};

type TextReplacementMergeResult = {
  merged_entries: TextReplacementEntry[];
  report: TextReplacementMergeReport;
};

export function merge_text_replacement_entries(
  existing_entries: TextReplacementEntry[],
  incoming_entries: TextReplacementEntry[],
): TextReplacementMergeResult {
  const { merged, report } = merge_quality_rule_entries({
    rule_type: QualityRuleMergeRuleTypeValue.PRE_REPLACEMENT,
    existing: existing_entries,
    incoming: incoming_entries,
    merge_mode: QualityRuleMergeModeValue.OVERWRITE,
  });

  return {
    merged_entries: merged as TextReplacementEntry[],
    report: {
      added: report.added,
      updated: report.updated,
      deduped: report.deduped,
    },
  };
}
