import { expectTypeOf, it } from "vitest";
import type { QualityRuleUpdateRequest } from "./quality-rule-api";

it("规则更新的元信息和条目由规则种类约束", () => {
  expectTypeOf<{
    rule_type: "text_preserve";
    expected_section_revisions: { quality: number };
    meta: { mode: "smart" };
  }>().toExtend<QualityRuleUpdateRequest>();
  expectTypeOf<{
    rule_type: "text_preserve";
    expected_section_revisions: { quality: number };
    meta: { enabled: boolean };
  }>().not.toExtend<QualityRuleUpdateRequest>();
  expectTypeOf<{
    rule_type: "pre_replacement";
    expected_section_revisions: { quality: number };
    entries: { entry_id: string; src: string; info: string }[];
  }>().not.toExtend<QualityRuleUpdateRequest>();
});
