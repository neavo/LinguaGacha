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

  it("reader 生成块 Item、排除状态和布局 metadata", async () => {
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
        status: "EXCLUDED",
        extra_field: { markdown: { before: "\n\n", after: "\n" } },
      }),
    ]);
  });

  it("常规 data URI 不进入 Item JSON", async () => {
    const format = new MDV2Format();
    const data_uri = "data:image/png;base64,AAAA";

    const items = await format.read_from_stream(
      new TextEncoder().encode(`![封面](${data_uri})`),
      "cover.md",
    );

    expect(JSON.stringify(items.map((item) => item.to_json()))).not.toContain(data_uri);
    expect(items[0]?.src).toBe("![封面](lg-resource:image/0)");
  });

  it("writer 按 row/id 稳定排序、恢复资源并只写单语文件", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-md-v2-"));
    const format = new MDV2Format();
    const source = "# 标题\n\n![封面](data:image/png;base64,AAAA)\n";
    const items = await format.read_from_stream(new TextEncoder().encode(source), "docs/demo.md");
    items[0]!.id = 2;
    items[0]!.dst = "# 译题";
    items[1]!.id = 1;
    items[1]!.dst = "![译图](lg-resource:image/0)";

    await format.write_to_path(
      [...items].reverse(),
      {
        translated_path: path.join(temp_dir.path, "translated"),
        bilingual_path: path.join(temp_dir.path, "bilingual"),
      },
      () => Buffer.from(source),
    );

    expect(
      fs.readFileSync(path.join(temp_dir.path, "translated", "docs", "demo.md"), "utf-8"),
    ).toBe("# 译题\n\n![译图](data:image/png;base64,AAAA)\n");
    expect(fs.existsSync(path.join(temp_dir.path, "bilingual", "docs", "demo.md"))).toBe(false);
  });

  it("资源缺失、token 改写或重复时按当前译文宽松输出", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-md-v2-"));
    const format = new MDV2Format();
    const items = [
      create_item({
        id: 3,
        row: 0,
        src: "![图](lg-resource:image/0)",
        dst: "![图](lg-resource:image/9)",
        before: "",
        after: "\n",
      }),
      create_item({
        id: 4,
        row: 1,
        src: "[链接](lg-resource:link/0)",
        dst: "[一](lg-resource:link/0) [二](lg-resource:link/0)",
        before: "",
        after: "",
      }),
    ];

    await format.write_to_path(
      items,
      { translated_path: temp_dir.path, bilingual_path: path.join(temp_dir.path, "bilingual") },
      () => Buffer.from("![图](img.png)\n[链接](https://example.com)"),
    );

    expect(fs.readFileSync(path.join(temp_dir.path, "demo.md"), "utf-8")).toBe(
      "![图](lg-resource:image/9)\n[一](https://example.com) [二](lg-resource:link/0)",
    );
  });

  it("非法 metadata 与缺失 asset 不阻止写出 Item 文本", async () => {
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

    await format.write_to_path(
      [item],
      { translated_path: temp_dir.path, bilingual_path: path.join(temp_dir.path, "bilingual") },
      () => null,
    );

    expect(fs.readFileSync(path.join(temp_dir.path, "demo.md"), "utf-8")).toBe("译文");
  });

  it("文本级 writer 不依赖 file_type，source 缺失时直接保留当前译文", () => {
    const item = Item.from_json({
      id: 2,
      src: "[原文](lg-resource:link/0)",
      dst: "[译文](lg-resource:link/0)",
      row: 0,
      file_type: "NONE",
      file_path: "demo.md",
      text_type: "MD",
      extra_field: { markdown: { before: "", after: "\n" } },
    });

    expect(new MDV2Format().write_text([item], null)).toBe("[译文](lg-resource:link/0)\n");
  });
});

function create_item(input: {
  id: number;
  row: number;
  src: string;
  dst: string;
  before: string;
  after: string;
}): Item {
  return Item.from_json({
    ...input,
    file_type: "MD_V2",
    file_path: "demo.md",
    text_type: "MD",
    extra_field: { markdown: { before: input.before, after: input.after } },
  });
}
