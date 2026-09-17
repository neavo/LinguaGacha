import { Type, type TSchema } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { create_schema_renderer } from "./schema-description";

describe("工作区 Schema 说明", () => {
  it("拒绝无法表达的校验约束，避免生成比运行时更宽松的说明", () => {
    const schema = Type.String({ format: "email" });
    expect(() => create_schema_renderer(new Map([[schema, "Email"]])).declarations()).toThrow(
      /format/u,
    );
  });

  it("保留必填、可选、联合分支和 TypeScript 无法表达的约束", () => {
    const schema = Type.Object(
      {
        id: Type.Integer({ minimum: 1 }),
        text: Type.Optional(Type.String({ minLength: 2, maxLength: 8, pattern: "^[a-z]+$" })),
        value: Type.Union([
          Type.Null(),
          Type.Object(
            {
              kind: Type.Literal("number"),
              amount: Type.Number({ exclusiveMinimum: 0, maximum: 10 }),
            },
            { additionalProperties: false },
          ),
        ]),
      },
      { additionalProperties: false, minProperties: 3, description: "至少提交一个修改字段。" },
    );
    const declaration = create_schema_renderer(new Map([[schema, "Update"]])).declarations();
    for (const expected of [
      "type Update =",
      "id: PositiveInteger",
      "text?: string",
      "value: (null |",
      'kind: "number"',
      "最少字段数: 3",
      "最短字符数: 2",
      "最长字符数: 8",
      '字符串格式: "^[a-z]+$"',
      "大于: 0",
      "最大值: 10",
      "至少提交一个修改字段",
    ])
      expect(declaration).toContain(expected);
    expect(declaration).not.toContain("[key: string]");
  });

  it("引用命名结构并保留开放对象的字段约束，正文不能终止生成注释", () => {
    const entry = Type.Object(
      { id: Type.String({ description: "文本 */ 后续" }) },
      { additionalProperties: true },
    );
    const records = {
      type: "object",
      patternProperties: { "^.*$": { type: "array", items: entry } },
    } satisfies TSchema;
    const renderer = create_schema_renderer(
      new Map<TSchema, string>([
        [entry, "Entry"],
        [records, "Entries"],
      ]),
    );
    expect(renderer.render(entry)).toBe("Entry");
    const declaration = renderer.declarations();
    expect(declaration).toContain("[key: string]: Array<Entry>");
    expect(declaration).toContain("id: string; [key: string]: unknown");
    expect(declaration).toContain("文本 *\\/ 后续");
  });
});
