import { describe, expect, it } from "vitest";

import { JsonTool } from "./json-tool";

describe("JsonTool", () => {
  it("解析字符串和二进制 JSON 载荷", () => {
    expect(JsonTool.parseStrict('{"name":"LinguaGacha","ok":true}')).toEqual({
      name: "LinguaGacha",
      ok: true,
    });
    expect(JsonTool.parseStrict(Buffer.from('{"count":2}', "utf-8"))).toEqual({ count: 2 });
  });

  it("解析带 UTF-8 BOM 的二进制 JSON", () => {
    expect(
      JsonTool.parseStrict(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"k":"v"}')]),
      ),
    ).toEqual({
      k: "v",
    });
  });

  it("兼容 Python 标准库接受的非有限数字", () => {
    const result = JsonTool.parseStrict<{
      nan: number;
      positive: number;
      negative: number;
      text: string;
    }>('{"nan":NaN,"positive":Infinity,"negative":-Infinity,"text":"NaN"}');

    expect(Number.isNaN(result.nan)).toBe(true);
    expect(result.positive).toBe(Number.POSITIVE_INFINITY);
    expect(result.negative).toBe(Number.NEGATIVE_INFINITY);
    expect(result.text).toBe("NaN");
  });

  it("损坏 JSON 仍抛出语法错误", () => {
    expect(() => JsonTool.parseStrict("{broken json")).toThrow(SyntaxError);
  });

  it("按指定缩进序列化文本", () => {
    expect(JsonTool.stringifyStrict({ id: 1 })).toBe('{"id":1}');
    expect(JsonTool.stringifyStrict({ id: 1 }, { indent: 4 })).toBe('{\n    "id": 1\n}');
  });

  it("序列化不可表示值时抛出类型错误", () => {
    expect(() => JsonTool.stringifyStrict(undefined)).toThrow(TypeError);
  });

  it("修复路径显式修复外部非标 JSON", async () => {
    expect(() => JsonTool.parseStrict('[{"src":"A",}]')).toThrow(SyntaxError);

    await expect(JsonTool.repairParse('[{"src":"A",}]')).resolves.toEqual([{ src: "A" }]);
  });
});
