import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JsonTool } from "./json-tool";

describe("JsonTool", () => {
  const cleanup_paths: string[] = [];

  afterEach(() => {
    while (cleanup_paths.length > 0) {
      const target_path = cleanup_paths.pop();
      if (target_path !== undefined) {
        fs.rmSync(target_path, { force: true, recursive: true });
      }
    }
  });

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

  it("文件写入先完成序列化，失败时不覆盖已有内容", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-json-tool-test-"));
    cleanup_paths.push(directory);
    const file_path = path.join(directory, "payload.json");
    fs.writeFileSync(file_path, '{"stable":true}', "utf-8");

    await expect(JsonTool.writeJsonFile(file_path, undefined)).rejects.toThrow(
      "JSON 序列化结果为空。",
    );

    expect(fs.readFileSync(file_path, "utf-8")).toBe('{"stable":true}');
  });

  it("文件助手支持 BOM 读取和缩进写入", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-json-tool-test-"));
    cleanup_paths.push(directory);
    const source_path = path.join(directory, "source.json");
    const output_path = path.join(directory, "output.json");
    fs.writeFileSync(source_path, '\uFEFF{"value":1}', "utf-8");

    await expect(JsonTool.readJsonFile(source_path)).resolves.toEqual({ value: 1 });
    await expect(JsonTool.loadFile(source_path)).resolves.toEqual({ value: 1 });
    await JsonTool.writeJsonFile(output_path, { value: 2 }, { indent: 4 });

    expect(fs.readFileSync(output_path, "utf-8")).toBe('{\n    "value": 2\n}');
  });

  it("文件助手默认按 4 空格缩进写入并能读回孤立代理", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-json-tool-test-"));
    cleanup_paths.push(directory);
    const file_path = path.join(directory, "payload.json");

    await JsonTool.saveFile(file_path, { text: "\uD800" }, { indent: 4 });

    expect(fs.readFileSync(file_path)).toEqual(Buffer.from('{\n    "text": "\\ud800"\n}'));
    await expect(JsonTool.loadFile(file_path)).resolves.toEqual({ text: "\uD800" });
  });

  it("文件助手按紧凑格式写入时保留孤立代理的转义字节", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-json-tool-test-"));
    cleanup_paths.push(directory);
    const file_path = path.join(directory, "compact.json");

    await JsonTool.saveFile(file_path, { text: "\uD800" }, { indent: 0 });

    expect(fs.readFileSync(file_path)).toEqual(Buffer.from('{"text":"\\ud800"}'));
    await expect(JsonTool.loadFile(file_path)).resolves.toEqual({ text: "\uD800" });
  });
});
