import { expect, it } from "vitest";
import { resolve_text_rule_type } from "./text-rule-type";

it("按条目格式和原文选择文本规则", () => {
  expect(resolve_text_rule_type({ file_type: "WOLFRPG" })).toBe("WOLF");
  expect(resolve_text_rule_type({ file_type: "GODOT" })).toBe("GODOT");
  expect(resolve_text_rule_type({ file_type: "RENPY" })).toBe("RENPY");
  expect(resolve_text_rule_type({ file_type: "RENPY_RPY" })).toBe("RENPY");
  expect(resolve_text_rule_type({ file_type: "RPGMAKER_MV_MZ" })).toBe("RPGMAKER");
  expect(resolve_text_rule_type({ file_type: "RPGMAKER_RGSS" })).toBe("RPGMAKER");
  expect(resolve_text_rule_type({ file_type: "MESSAGEJSON" })).toBe("KAG");
  expect(resolve_text_rule_type({ file_type: "MD_V2" })).toBe("MD");
  expect(resolve_text_rule_type({ file_type: "KVJSON", src: "{i}Start{/i}" })).toBe("RENPY");
  expect(resolve_text_rule_type({ file_type: "KVJSON", src: "{中文正文}" })).toBe("NONE");
  expect(resolve_text_rule_type({ file_type: "KVJSON", src: "@12 你好" })).toBe("WOLF");
  expect(resolve_text_rule_type({ file_type: "KVJSON", src: "你好 \\c[2]" })).toBe("RPGMAKER");
});
