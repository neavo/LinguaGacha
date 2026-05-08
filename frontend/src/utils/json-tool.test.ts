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

  it("按 Node 原生行为转义孤立代理字符", () => {
    expect(JsonTool.stringifyStrict("\uD800")).toBe('"\\ud800"');
  });

  it("修复路径显式修复外部非标 JSON", async () => {
    expect(() => JsonTool.parseStrict('[{"src":"A",}]')).toThrow(SyntaxError);

    await expect(JsonTool.repairParse('[{"src":"A",}]')).resolves.toEqual([{ src: "A" }]);
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
    await JsonTool.writeJsonFile(output_path, { value: 2 }, { indent: 4 });

    expect(fs.readFileSync(output_path, "utf-8")).toBe('{\n    "value": 2\n}');
  });
});
