import { expect, it } from "vitest";
import { Item } from "../../../domain/item";
import { ASSFormat } from "./ass-ssa-format";

const FORMAT = "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";
const PREFIX = "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,";
const format = new ASSFormat({ target_language: "ZH", deduplication_in_bilingual: true });

it("按正文边界写回同值字段、正文逗号与模板字面量，保留原始布局", async () => {
  const prefix = "Dialogue: 0,0:00:01.00,0:00:02.00,{{CONTENT}},Hello,0,0,0,,";
  const text = `[Events]\r\n${FORMAT}\r\n${prefix}Hello\r\n; 尾部  \r\n`;
  const items = await format.read_from_stream(Buffer.from(text), "sub.ass");
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ src: "Hello", row: 2, file_type: "ASS" });
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "你好,世界$&{{CONTENT}}\n第二行";
  const output = format.render_text(text, items, "sub.ass");
  expect(output.translated).toBe(
    `[Events]\r\n${FORMAT}\r\n${prefix}你好,世界$&{{CONTENT}}\\N第二行\r\n; 尾部  \r\n`,
  );
  expect(output.bilingual).toContain(`${prefix}Hello\\N你好,世界$&{{CONTENT}}\\N第二行`);
});

it("Text 非末列时拒绝解析", async () => {
  await expect(
    format.read_from_stream(
      Buffer.from("[Events]\nFormat: Text, Layer\nDialogue: hello,0"),
      "bad.ass",
    ),
  ).rejects.toMatchObject({
    code: "file.invalid_structure",
    public_details: { file: "bad.ass", line: 2 },
  });
});

it("缺少 Format 时识别标准 ASS／SSA 布局，拒绝负索引式截取", async () => {
  for (const first of ["0", "Marked=0"]) {
    const text = `[Events]\n${PREFIX.replace("Dialogue: 0,", `Dialogue: ${first},`)}one,two\\Nthree`;
    expect((await format.read_from_stream(Buffer.from(text), "sub.ssa"))[0]?.src).toBe(
      "one,two\nthree",
    );
  }
  await expect(
    format.read_from_stream(Buffer.from("[Events]\nDialogue: too,few,fields"), "bad.ass"),
  ).rejects.toMatchObject({ code: "file.invalid_structure" });
});

it("段落切换重新读取字段，Events 外的 Dialogue 原样保存", async () => {
  const text = `[Events]\n${FORMAT}\n${PREFIX}A\n[Other]\nDialogue: raw\n[Events]\nFormat: Layer, Text\nDialogue: 0,B,C`;
  expect(
    (await format.read_from_stream(Buffer.from(text), "sub.ass")).map((item) => item.src),
  ).toEqual(["A", "B,C"]);
  expect(format.render_text(text, [], "sub.ass").translated).toBe(text);
});

it("旧项目的行号和译文直接写回，历史模板不决定正文位置", () => {
  const before = `[Events]\n${FORMAT}\n${PREFIX}首句\u2028尾句\n`;
  const text = `${before}${PREFIX}原文\n`;
  const item = Item.from_json({
    row: 4,
    src: "原文",
    dst: "",
    status: "PROCESSED",
    extra_field: "错误{{CONTENT}}模板",
  });
  const structural = Item.from_json({ row: 3, src: "", extra_field: "尾句" });
  expect(format.render_text(text, [structural, item], "old.ass")).toEqual({
    translated: `${before}${PREFIX}\n`,
    bilingual: text,
  });
  item.status = "ERROR";
  item.dst = "暂存";
  expect(format.render_text(text, [structural, item], "old.ass").translated).toBe(text);
});
