import type { GlossaryEntry, TextPreserveEntry, TextReplacementEntry } from "../../domain/quality";

type ProofreadingLookupQuery = {
  keyword: string;
  is_regex: boolean;
  scope: "src" | "dst" | "all";
};

/**
 * 质量规则页跳转校对查找时，文本保护规则始终按正则语义查询。
 */
export function buildProofreadingLookupQuery(
  args:
    | {
        rule_type: "glossary";
        entry: GlossaryEntry;
      }
    | {
        rule_type: "text_preserve";
        entry: TextPreserveEntry;
      }
    | {
        rule_type: "pre_replacement" | "post_replacement";
        entry: TextReplacementEntry;
      },
): ProofreadingLookupQuery {
  const keyword = args.entry.src;

  if (args.rule_type === "text_preserve") {
    return {
      keyword,
      is_regex: true,
      scope: "src",
    };
  }

  return {
    keyword,
    is_regex: args.rule_type === "glossary" ? false : Boolean(args.entry.regex),
    scope: args.rule_type === "post_replacement" ? "dst" : "src",
  };
}
