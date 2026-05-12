import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Item } from "../../../base/item";
import { MDFormat } from "./md-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-md-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("MDFormat", () => {
  it("排除图片行和代码块行，正文保持可翻译", async () => {
    const format = new MDFormat({ source_language: "JA", target_language: "ZH" });

    const items = await format.read_from_stream(
      new TextEncoder().encode("正文\n![图](a.png)\n```js\ncode\n```"),
      "demo.md",
    );

    expect(items.map((item) => [item.src, item.status])).toEqual([
      ["正文", "NONE"],
      ["![图](a.png)", "EXCLUDED"],
      ["```js", "EXCLUDED"],
      ["code", "EXCLUDED"],
      ["```", "NONE"],
    ]);
  });

  it("写出目标语言后缀的 Markdown 译文", async () => {
    const format = new MDFormat({ source_language: "JA", target_language: "ZH" });
    await format.write_to_path(
      [
        Item.from_json({
          src: "原文",
          dst: "译文",
          row: 0,
          file_type: "MD",
          file_path: "notes.md",
        }),
      ],
      {
        translated_path: path.join(temp_dir, "translated"),
        bilingual_path: path.join(temp_dir, "bilingual"),
      },
    );

    expect(fs.readFileSync(path.join(temp_dir, "translated", "notes.zh.md"), "utf-8")).toBe("译文");
  });
});
