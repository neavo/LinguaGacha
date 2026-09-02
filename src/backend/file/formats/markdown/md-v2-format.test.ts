import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { Item } from "../../../../domain/item";
import { MDV2Format } from "./md-v2-format";

describe("MDV2Format", () => {
  it("文本级 reader 与 stream reader 产生相同块契约", async () => {
    const format = new MDV2Format();
    const text = "# 标题\n\n正文\n";

    expect(format.read_text(text, "demo.md").map((item) => item.to_json())).toEqual(
      (await format.read_from_stream(new TextEncoder().encode(text), "demo.md")).map((item) =>
        item.to_json(),
      ),
    );
  });

  it("reader 生成块 Item、规则跳过状态和布局 metadata", async () => {
    const format = new MDV2Format();
    const items = await format.read_from_stream(
      new TextEncoder().encode("# 标题\n\n正文第一行\n正文第二行\n\n```ts\ncode\n```\n"),
      "docs/readme.md",
    );

    expect(items.map((item) => item.to_json())).toEqual([
      expect.objectContaining({
        src: "# 标题",
        row: 0,
        file_type: "MD_V2",
        file_path: "docs/readme.md",
        text_type: "MD",
        status: "NONE",
        extra_field: { markdown: { before: "", after: "" } },
      }),
      expect.objectContaining({
        src: "正文第一行\n正文第二行",
        row: 2,
        status: "NONE",
        extra_field: { markdown: { before: "\n\n", after: "" } },
      }),
      expect.objectContaining({
        src: "```ts\ncode\n```",
        row: 5,
        status: "RULE_SKIPPED",
        extra_field: { markdown: { before: "\n\n", after: "\n" } },
      }),
    ]);
  });

  it("URI 和 Base64 data URI 原样进入块 Item", async () => {
    const format = new MDV2Format();
    const data_uri = "data:image/png;base64,AAAA";

    const items = await format.read_from_stream(
      new TextEncoder().encode(`![封面](${data_uri})`),
      "cover.md",
    );

    expect(items[0]?.src).toBe(`![封面](${data_uri})`);
  });

  it("writer 按 row/id 稳定排序并只写单语文件", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-md-v2-"));
    const format = new MDV2Format();
    const source = "# 标题\n\n![封面](data:image/png;base64,AAAA)\n";
    const items = await format.read_from_stream(new TextEncoder().encode(source), "docs/demo.md");
    items[0]!.id = 2;
    items[0]!.dst = "# 译题";
    items[1]!.id = 1;
    items[1]!.dst = "![译图](data:image/png;base64,AAAA)";

    await format.write_to_path([...items].reverse(), {
      translated_path: path.join(temp_dir.path, "translated"),
      bilingual_path: path.join(temp_dir.path, "bilingual"),
    });

    expect(
      fs.readFileSync(path.join(temp_dir.path, "translated", "docs", "demo.md"), "utf-8"),
    ).toBe("# 译题\n\n![译图](data:image/png;base64,AAAA)\n");
    expect(fs.existsSync(path.join(temp_dir.path, "bilingual", "docs", "demo.md"))).toBe(false);
  });

  it("非法 metadata 不阻止写出 Item 文本", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-md-v2-"));
    const format = new MDV2Format();
    const item = Item.from_json({
      src: "原文",
      dst: "译文",
      row: 0,
      file_type: "MD_V2",
      file_path: "demo.md",
      extra_field: { markdown: { before: 1, after: null } },
    });

    await format.write_to_path([item], {
      translated_path: temp_dir.path,
      bilingual_path: path.join(temp_dir.path, "bilingual"),
    });

    expect(fs.readFileSync(path.join(temp_dir.path, "demo.md"), "utf-8")).toBe("译文");
  });

  it("文本级 writer 不依赖 file_type", () => {
    const item = Item.from_json({
      id: 2,
      src: "[原文](https://example.com)",
      dst: "[译文](https://example.com)",
      row: 0,
      file_type: "NONE",
      file_path: "demo.md",
      text_type: "MD",
      extra_field: { markdown: { before: "", after: "\n" } },
    });

    expect(new MDV2Format().write_text([item])).toBe("[译文](https://example.com)\n");
  });
});
