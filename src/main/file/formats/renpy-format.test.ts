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

  it("跳过资源路径、纯占位符和纯样式标记", () => {
    const format = new RenPyFormat();

    const items = format.parse_text(
      "script.rpy",
      [
        "translate schinese strings:",
        '    old "bg/scene.png"',
        '    new "bg/scene.png"',
        '    old "[player_name]"',
        '    new "[player_name]"',
        '    old "{b}{/b}"',
        '    new "{b}{/b}"',
        '    old "{#language name and font}"',
        '    new "{#language name and font}"',
      ].join("\n"),
    );

    expect(items.map((item) => item.src)).toEqual(["{#language name and font}"]);
  });

  it("解析 Character 调用中的姓名和对白", () => {
    const format = new RenPyFormat();

    const [item] = format.parse_text(
      "chapter.rpy",
      [
        "translate schinese chapter_5_d8798af6:",
        "",
        '    # Character("Man") "Hello there!"',
        '    Character("Man") "你好啊123！"',
      ].join("\n"),
    );

    expect(item).toEqual(
      expect.objectContaining({
        name_src: "Man",
        src: "Hello there!",
        name_dst: "Man",
        dst: "你好啊123！",
      }),
    );
  });

  it("忽略 cb_name 后缀中的尾随字符串，只抽取对白", () => {
    const format = new RenPyFormat();

    const [item] = format.parse_text(
      "relationships.rpy",
      [
        "translate chinese relationships_f8b6714e:",
        "",
        '    # "This is karen, wife of Marco." (cb_name="kr")',
        '    "This is karen, wife of Marco." (cb_name="卡雷")',
      ].join("\n"),
    );

    expect(item).toEqual(
      expect.objectContaining({
        name_src: null,
        src: "This is karen, wife of Marco.",
        dst: "This is karen, wife of Marco.",
      }),
    );
  });

  it("保留 PushMove 参数并只把连续前两个字符串作为姓名和对白", () => {
    const format = new RenPyFormat();

    const [item] = format.parse_text(
      "pushmove.rpy",
      [
        "translate schinese chapter_5_79f2f130:",
        "",
        '    # "Man" "Pleasure to meet you." with PushMove("x")',
        '    "Man" "" with PushMove("x")',
      ].join("\n"),
    );

    expect(item).toEqual(
      expect.objectContaining({
        name_src: "Man",
        src: "Pleasure to meet you.",
        name_dst: "Man",
        dst: "",
      }),
    );
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

  it("写回对白时不改动尾随函数参数字符串", async () => {
    const format = new RenPyFormat();
    const text = [
      "translate schinese chapter_5_79f2f130:",
      "",
      '    # "Man" "Pleasure to meet you." with PushMove("x")',
      '    "Man" "" with PushMove("x")',
    ].join("\n");
    const [item] = format.parse_text("pushmove.rpy", text);
    if (item === undefined) {
      throw new Error("测试样本应生成 RenPy 条目。");
    }
    item.dst = "很高兴见到你。";

    await format.write_to_path(
      [item],
      { translated_path: temp_dir, bilingual_path: path.join(temp_dir, "bilingual") },
      () => Buffer.from(text),
    );

    expect(fs.readFileSync(path.join(temp_dir, "pushmove.rpy"), "utf-8")).toContain(
      '"很高兴见到你。" "" with PushMove("x")',
    );
  });
});
