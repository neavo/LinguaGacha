import type { GlossaryEntry } from "@/pages/glossary-page/types";
import {
  QualityRuleMergeModeValue,
  QualityRuleMergeRuleTypeValue,
  merge_quality_rule_entries,
} from "@shared/quality/merger";

type GlossaryMergeReport = {
  added: number;
  updated: number;
  deduped: number;
};

type GlossaryMergeResult = {
  merged_entries: GlossaryEntry[];
  report: GlossaryMergeReport;
};

export function merge_glossary_entries(
  existing_entries: GlossaryEntry[],
  incoming_entries: GlossaryEntry[],
): GlossaryMergeResult {
  const { merged, report } = merge_quality_rule_entries({
    rule_type: QualityRuleMergeRuleTypeValue.GLOSSARY,
    existing: existing_entries,
    incoming: incoming_entries,
    merge_mode: QualityRuleMergeModeValue.OVERWRITE,
  });

  return {
    merged_entries: merged as GlossaryEntry[],
    report: {
      added: report.added,
      updated: report.updated,
      deduped: report.deduped,
    },
  };
}
