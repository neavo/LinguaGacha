import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Item } from "../../../domain/item";
import { MDFormat } from "./md-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-md-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("MDFormat", () => {
  it("标记代码块和图片行为排除状态", async () => {
    const format = new MDFormat({ source_language: "JA", target_language: "ZH" });

    const items = await format.read_from_stream(
      new TextEncoder().encode("标题\n```python\nprint('hi')\n```\n![img](a.png)\n正文"),
      "docs/readme.md",
    );

    expect(items.map((item) => item.src)).toEqual([
      "标题",
      "```python",
      "print('hi')",
      "```",
      "![img](a.png)",
      "正文",
    ]);
    expect(items.map((item) => item.status)).toEqual([
      "NONE",
      "EXCLUDED",
      "EXCLUDED",
      "NONE",
      "EXCLUDED",
      "NONE",
    ]);
  });

  it("写出沿用源文件名的 Markdown 译文并忽略其它文件类型", async () => {
    const format = new MDFormat({ source_language: "JA", target_language: "ZH" });
    await format.write_to_path(
      [
        Item.from_json({
          src: "a",
          dst: "甲",
          row: 0,
          file_type: "MD",
          file_path: "docs/readme.md",
        }),
        Item.from_json({
          src: "b",
          dst: "乙",
          row: 1,
          file_type: "MD",
          file_path: "docs/readme.md",
        }),
        Item.from_json({
          src: "ignore",
          dst: "ignore",
          row: 0,
          file_type: "TXT",
          file_path: "docs/other.txt",
        }),
      ],
      {
        translated_path: path.join(temp_dir, "translated"),
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    expect(fs.readFileSync(path.join(temp_dir, "translated", "docs", "readme.md"), "utf-8")).toBe(
      "甲\n乙",
    );
    expect(fs.existsSync(path.join(temp_dir, "translated", "docs", "other.txt"))).toBe(false);
  });
});
