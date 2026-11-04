import { describe, expect, it } from "vitest";
import type { JsonValue } from "../../../domain/json";
import { MESSAGEJSONFormat } from "./messagejson-format";

const format = new MESSAGEJSONFormat();

describe("MESSAGEJSONFormat", () => {
  it("导入只提取当前姓名和有效台词序号", () => {
    const source: JsonValue = [
      { command: "wait" },
      { name: "Alice", names: ["ignored"], message: "one" },
      null,
      { names: [123, "Bob", "tail"], message: "two" },
      { names: [false], message: "three" },
      { name: "", names: ["ignored"], message: "four" },
    ];
    const items = format.read_items(source, "m.json");
    expect(
      items.map(({ row, src, name_src, name_dst, dst }) => ({ row, src, name_src, name_dst, dst })),
    ).toEqual([
      { row: 0, src: "one", name_src: "Alice", name_dst: null, dst: "" },
      { row: 1, src: "two", name_src: "Bob", name_dst: null, dst: "" },
      { row: 2, src: "three", name_src: null, name_dst: null, dst: "" },
      { row: 3, src: "four", name_src: "", name_dst: null, dst: "" },
    ]);
    expect(format.read_items({ message: "one" }, "m.json")).toEqual([]);
  });

  it("按有效台词序号写回并保留所有源字段和未参与翻译的元素", () => {
    const source: JsonValue = [
      { command: "wait" },
      { name: "Alice", names: ["ignored"], message: "same", voice: "001" },
      null,
      { names: [123, "Bob", "tail"], message: "same", flag: true },
      { names: [false, { private: true }], message: "three" },
      { name: 42, message: "four" },
      { names: [123, "", "tail"], message: "five" },
      { message: "untouched", extra: [1, 2] },
    ];
    const items = format.read_items(source, "m.json");
    const updates = [
      { ...items[3]!, name_dst: "四" },
      { ...items[1]!, status: "PROCESSED" as const, dst: "第二句", name_dst: "鲍勃" },
      { ...items[0]!, status: "PROCESSED" as const, dst: "", name_dst: "爱丽丝" },
      { ...items[2]!, status: "NONE" as const, dst: "忽略", name_dst: "三" },
      { ...items[4]!, name_dst: "" },
    ];
    expect(JSON.parse(format.render_text(JSON.stringify(source), updates, "m.json"))).toEqual([
      { command: "wait" },
      { name: "爱丽丝", names: ["ignored"], message: "", voice: "001" },
      null,
      { names: [123, "鲍勃", "tail"], message: "第二句", flag: true },
      { names: ["三", false, { private: true }], message: "three" },
      { name: "四", message: "four" },
      { names: [123, "", "tail"], message: "five" },
      { message: "untouched", extra: [1, 2] },
    ]);
  });

  it("拒绝非数组源结构", () => {
    expect(() => format.render_text("{}", [], "m.json")).toThrow(
      expect.objectContaining({ code: "file.invalid_structure" }),
    );
  });
});
