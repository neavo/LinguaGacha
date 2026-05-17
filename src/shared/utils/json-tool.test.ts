import { describe, expect, it } from "vitest";

import { JsonTool } from "./json-tool";

describe("JsonTool", () => {
  it("严格路径解析 BOM 并使用原生紧凑序列化", () => {
    const parsed = JsonTool.parseStrict<{ value: number }>('\uFEFF{"value":7}');

    expect(parsed).toEqual({ value: 7 });
    expect(JsonTool.stringifyStrict({ value: 7 })).toBe('{"value":7}');
  });

  it("解析字符串和二进制 JSON 载荷", () => {
    expect(JsonTool.loads('{"name":"LinguaGacha","ok":true}')).toEqual({
      name: "LinguaGacha",
      ok: true,
    });
    expect(JsonTool.loads(Buffer.from('{"count":2}', "utf-8"))).toEqual({ count: 2 });
  });

  it("解析带 UTF-8 BOM 的二进制 JSON", () => {
    expect(
      JsonTool.loads(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"k":"v"}')])),
    ).toEqual({
      k: "v",
    });
  });

  it("兼容 Python 标准库接受的非有限数字", () => {
    const result = JsonTool.loads<{ score: number }>('{"score": NaN}');

    expect(Number.isNaN(result.score)).toBe(true);
  });

  it("损坏 JSON 仍抛出语法错误", () => {
    expect(() => JsonTool.loads("{broken json")).toThrow(SyntaxError);
  });

  it("按 Node 原生行为转义孤立代理字符", () => {
    expect(JsonTool.stringifyStrict("\uD800")).toBe('"\\ud800"');
  });

  it("按指定缩进序列化文本和 bytes", () => {
    expect(JsonTool.dumps({ id: 1 })).toBe('{"id":1}');
    expect(JsonTool.dumps({ id: 1 }, { indent: 4 })).toBe('{\n    "id": 1\n}');
    expect(JsonTool.dumpsBytes({ a: 1, b: 2 }).toString("utf-8")).toBe('{"a":1,"b":2}');
    expect(JsonTool.dumpsBytes({ a: 1, b: 2 }, { indent: 2 }).toString("utf-8")).toContain(
      '\n  "a": 1',
    );
  });

  it("序列化不可表示值时抛出类型错误", () => {
    expect(() => JsonTool.dumpsBytes(undefined)).toThrow(TypeError);
  });

  it("修复路径显式修复外部非标 JSON", async () => {
    expect(() => JsonTool.parseStrict('[{"src":"A",}]')).toThrow(SyntaxError);

    await expect(JsonTool.repairParse('[{"src":"A",}]')).resolves.toEqual([{ src: "A" }]);
    await expect(JsonTool.repairLoads('{"v":1,}')).resolves.toEqual({ v: 1 });
  });
});
