import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RenPyFormat } from "./renpy-format";

let temp_dir = "";

beforeEach(() => {
  temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-renpy-format-"));
});

afterEach(() => {
  fs.rmSync(temp_dir, { recursive: true, force: true });
});

describe("RenPyFormat", () => {
  it("解析 strings 块 old/new 文本并识别已处理译文", () => {
    const format = new RenPyFormat();

    const items = format.parse_text(
      "script.rpy",
      'translate schinese strings:\n\n    old "START"\n    new "开始"\n',
    );

    expect(items).toEqual([
      expect.objectContaining({
        src: "START",
        dst: "开始",
        row: 3,
        file_type: "RENPY",
        status: "PROCESSED",
      }),
    ]);
  });

  it("解析注释模板与目标对白行，保留角色名和对白槽位", () => {
    const format = new RenPyFormat();

    const items = format.parse_text(
      "script.rpy",
      'translate schinese start:\n\n    # "Alice" "Hello"\n    "爱丽丝" "你好"\n',
    );

    expect(items).toEqual([
      expect.objectContaining({
        src: "Hello",
        dst: "你好",
        name_src: "Alice",
        name_dst: "爱丽丝",
        status: "PROCESSED",
      }),
    ]);
  });

  it("写回时按 extra_field target_line 替换目标行文本", async () => {
    const format = new RenPyFormat();
    const text = 'translate schinese strings:\n\n    old "START"\n    new ""\n';
    const [item] = format.parse_text("script.rpy", text);
    if (item === undefined) {
      throw new Error("测试样本应生成 RenPy 条目。");
    }
    item.dst = "开始";

    await format.write_to_path(
      [item],
      { translated_path: temp_dir, bilingual_path: path.join(temp_dir, "bilingual") },
      () => Buffer.from(text),
    );

    expect(fs.readFileSync(path.join(temp_dir, "script.rpy"), "utf-8")).toContain('new "开始"');
  });
});
