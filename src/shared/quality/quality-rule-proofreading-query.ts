import type { QualityRuleKind } from "../../domain/quality";

type QualityStateRuleKind = QualityRuleKind;

type ProofreadingLookupQuery = {
  keyword: string;
  is_regex: boolean;
};

/**
 * 质量规则页跳转校对查找时，文本保护规则始终按正则语义查询。
 */
export function buildProofreadingLookupQuery(args: {
  rule_type: QualityStateRuleKind;
  entry: Record<string, unknown>;
}): ProofreadingLookupQuery {
  const keyword = String(args.entry.src ?? "").trim();

  if (args.rule_type === "text_preserve") {
    return {
      keyword,
      is_regex: true,
    };
  }

  return {
    keyword,
    is_regex: Boolean(args.entry.regex),
  };
}
