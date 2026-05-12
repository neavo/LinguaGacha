import type { TextPreserveEntry } from "@/pages/text-preserve-page/types";
import {
  QualityRuleMergeModeValue,
  QualityRuleMergeRuleTypeValue,
  merge_quality_rule_entries,
} from "@shared/quality/merger";

type TextPreserveMergeReport = {
  updated: number;
  deduped: number;
};

type TextPreserveMergeResult = {
  merged_entries: TextPreserveEntry[];
  report: TextPreserveMergeReport;
};

export function merge_text_preserve_entries(
  existing_entries: TextPreserveEntry[],
  incoming_entries: TextPreserveEntry[],
): TextPreserveMergeResult {
  const { merged, report } = merge_quality_rule_entries({
    rule_type: QualityRuleMergeRuleTypeValue.TEXT_PRESERVE,
    existing: existing_entries,
    incoming: incoming_entries,
    merge_mode: QualityRuleMergeModeValue.OVERWRITE,
  });

  return {
    merged_entries: merged as TextPreserveEntry[],
    report: {
      updated: report.updated,
      deduped: report.deduped,
    },
  };
}
