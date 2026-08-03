import { describe, expect, it } from "vitest";

import { read_item_source_text_parts, read_item_translation_text_parts } from "../item-text";
import {
  compile_glossary,
  evaluate_glossary_applications,
  match_glossary_source,
  resolve_glossary_application_state,
  type GlossaryEntry,
} from "./glossary";

const entries: GlossaryEntry[] = [
  { entry_id: "hp", src: "HP", dst: "生命值", info: "", case_sensitive: true },
  { entry_id: "name", src: "Alice", dst: "爱丽丝", info: "角色", case_sensitive: false },
  { entry_id: "empty", src: "MP", dst: "   ", info: "", case_sensitive: false },
  { entry_id: "duplicate", src: "HP", dst: "体力", info: "", case_sensitive: true },
];

describe("共享术语领域规则", () => {
  it("按原始正文与姓名分别覆盖，保留重叠次数和 entry_id 身份", () => {
    const matches = match_glossary_source(
      compile_glossary(entries),
      read_item_source_text_parts({ src: "HP HP", name_src: "ALICE" }),
    );

    expect(matches.map(({ entry, fields }) => ({ entry_id: entry.entry_id, fields }))).toEqual([
      {
        entry_id: "hp",
        fields: [
          {
            source_field: "src",
            target_field: "dst",
            ranges: [
              { start: 0, end: 2 },
              { start: 3, end: 5 },
            ],
          },
        ],
      },
      {
        entry_id: "name",
        fields: [
          {
            source_field: "name_src",
            target_field: "name_dst",
            ranges: [{ start: 0, end: 5 }],
          },
        ],
      },
      {
        entry_id: "duplicate",
        fields: [
          {
            source_field: "src",
            target_field: "dst",
            ranges: [
              { start: 0, end: 2 },
              { start: 3, end: 5 },
            ],
          },
        ],
      },
    ]);
  });

  it("严格按对应目标字段求值，空 dst 不形成 warning", () => {
    const matches = match_glossary_source(
      compile_glossary(entries),
      read_item_source_text_parts({ src: "HP MP", name_src: "Alice" }),
    );
    const applications = evaluate_glossary_applications(
      matches,
      read_item_translation_text_parts({ dst: "生命值 爱丽丝", name_dst: "未翻译" }),
    );

    expect(applications.map(({ entry_id, fields }) => ({ entry_id, fields }))).toEqual([
      {
        entry_id: "hp",
        fields: [{ source_field: "src", target_field: "dst", applied: true }],
      },
      {
        entry_id: "name",
        fields: [{ source_field: "name_src", target_field: "name_dst", applied: false }],
      },
      {
        entry_id: "duplicate",
        fields: [{ source_field: "src", target_field: "dst", applied: false }],
      },
    ]);
    expect(resolve_glossary_application_state(applications)).toBe("partial");
  });

  it("不跨字段拼接，也不读取全局开关", () => {
    const compiled = compile_glossary([
      { entry_id: "split", src: "hello", dst: "你好", info: "", case_sensitive: false },
    ]);
    expect(
      match_glossary_source(compiled, [
        { field: "src", text: "hel" },
        { field: "name_src", text: "lo" },
      ]),
    ).toEqual([]);
    expect(resolve_glossary_application_state([])).toBe("none");
  });
});
