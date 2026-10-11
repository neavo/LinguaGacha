import { expect, it } from "vitest";
import { resolve_text_rule_type } from "./text-rule-type";

it("文件格式、TRANS 引擎和通用文本语法共用规则选择", () => {
  expect(resolve_text_rule_type({ file_type: "RPGMAKER_MV_MZ" })).toBe("RPGMAKER");
  expect(resolve_text_rule_type({ file_type: "RPGMAKER_RGSS" })).toBe("RPGMAKER");
  expect(resolve_text_rule_type({ file_type: "MESSAGEJSON" })).toBe("KAG");
  expect(resolve_text_rule_type({ file_type: "MD_V2" })).toBe("MD");
  expect(resolve_text_rule_type({ file_type: "KVJSON", src: "{i}Start{/i}" })).toBe("RENPY");
  expect(resolve_text_rule_type({ file_type: "KVJSON", src: "{中文正文}" })).toBe("NONE");
  expect(resolve_text_rule_type({ file_type: "XLSX", src: "@12 你好" })).toBe("WOLF");
  for (const [engine, expected] of [
    ["rmmz", "RPGMAKER"],
    ["wolfrpg", "WOLF"],
    ["wolf", "WOLF"],
    ["renpy", "RENPY"],
    ["vntrans", "KAG"],
    ["kag", "KAG"],
    ["unknown", "NONE"],
  ])
    expect(
      resolve_text_rule_type({ src: "text" }, { file_type: "TRANS", game_engine: engine }),
    ).toBe(expected);
});
