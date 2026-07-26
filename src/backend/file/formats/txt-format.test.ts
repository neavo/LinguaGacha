import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { Item } from "../../../domain/item";
import { TXTFormat } from "./txt-format";

describe("TXTFormat", () => {
  it("按不同换行符拆分 TXT 流并标记文件类型", async () => {
    const format = new TXTFormat({ target_language: "ZH" });

    const items = await format.read_from_stream(
      new TextEncoder().encode("第一行\r\n第二行\n第三行"),
      "a.txt",
    );

    expect(items.map((item) => item.src)).toEqual(["第一行", "第二行", "第三行"]);
    expect(items.every((item) => item.file_type === "TXT")).toBe(true);
    expect(items.map((item) => item.row)).toEqual([0, 1, 2]);
  });

  it("写出译文和双语 TXT 文件", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-txt-format-"));
    const format = new TXTFormat({
      target_language: "ZH",
      deduplication_in_bilingual: true,
    });
    await format.write_to_path(
      [
        Item.from_json({
          src: "同文",
          dst: "同文",
          row: 0,
          file_type: "TXT",
          file_path: "story/dialog.txt",
        }),
        Item.from_json({
          src: "原文",
          dst: "译文",
          row: 1,
          file_type: "TXT",
          file_path: "story/dialog.txt",
        }),
      ],
      {
        translated_path: path.join(temp_dir.path, "translated"),
        bilingual_path: path.join(temp_dir.path, "bilingual"),
      },
    );

    expect(
      fs.readFileSync(path.join(temp_dir.path, "translated", "story", "dialog.txt"), "utf-8"),
    ).toBe("同文\n译文");
    expect(
      fs.readFileSync(path.join(temp_dir.path, "bilingual", "story", "dialog.txt"), "utf-8"),
    ).toBe("同文\n原文\n译文");
  });

  it("空译文写回时使用原文并在双语输出中去重", async () => {
    using temp_dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "linguagacha-txt-format-"));
    const format = new TXTFormat({
      target_language: "ZH",
      deduplication_in_bilingual: true,
    });

    await format.write_to_path(
      [
        Item.from_json({
          src: "原文",
          dst: "译文",
          row: 0,
          file_type: "TXT",
          file_path: "script.txt",
        }),
        Item.from_json({
          src: "同文",
          dst: "",
          row: 1,
          file_type: "TXT",
          file_path: "script.txt",
        }),
      ],
      {
        translated_path: path.join(temp_dir.path, "demo_译文"),
        bilingual_path: path.join(temp_dir.path, "demo_译文_双语对照"),
      },
    );

    expect(fs.readFileSync(path.join(temp_dir.path, "demo_译文", "script.txt"), "utf-8")).toBe(
      "译文\n同文",
    );
    expect(
      fs.readFileSync(path.join(temp_dir.path, "demo_译文_双语对照", "script.txt"), "utf-8"),
    ).toBe("原文\n译文\n同文");
  });
});
