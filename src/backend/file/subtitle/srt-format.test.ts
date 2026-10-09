import { expect, it } from "vitest";
import { create_item } from "../../../domain/item";
import { SRTFormat } from "./srt-format";

const format = new SRTFormat({ target_language: "ZH", deduplication_in_bilingual: true });
it("解析字幕序号、时间轴和实际换行，跳过非数字序号块", async () => {
  const text =
    "\n1\n00:00:01,000 --> 00:00:02,000\n第一句\n\nx\nwrong\n跳过\n\n2\n00:00:03,000 --> 00:00:04,000\n第二句\n第二行\n";
  const items = await format.read_from_stream(Buffer.from(text), "sub.srt");
  expect(items.map((item) => [item.row, item.src])).toEqual([
    [1, "第一句"],
    [2, "第二句\n第二行"],
  ]);
  expect(items[0]?.extra_field).toBe("00:00:01,000 --> 00:00:02,000");
});
it.each(["", " \n "])("完成空正文 %j 省略单语块，未完成回源，双语保留原文", async (dst) => {
  const items = [
    create_item({
      src: "删除",
      dst,
      status: "PROCESSED",
      row: 7,
      extra_field: "00:00:01,000 --> 00:00:02,000",
    }),
    create_item({
      src: "保留",
      dst: "暂存",
      status: "ERROR",
      row: 9,
      extra_field: "00:00:03,000 --> 00:00:04,000",
    }),
  ];
  const output = format.render_text("", items, "sub.srt");
  expect(
    (await format.read_from_stream(Buffer.from(output.translated), "sub.srt")).map((item) => [
      item.row,
      item.src,
    ]),
  ).toEqual([[1, "保留"]]);
  expect(output.bilingual).toContain("7\n00:00:01,000 --> 00:00:02,000\n删除\n\n");
});
it.each([false, true])("双语去重=%s 控制同文输出", (deduplicate) => {
  const item = create_item({
    src: "同文",
    dst: "同文",
    status: "PROCESSED",
    row: 1,
    extra_field: "time",
  });
  const output = new SRTFormat({
    target_language: "ZH",
    deduplication_in_bilingual: deduplicate,
  }).render_text("", [item], "sub.srt");
  expect(output.bilingual).toBe(`1\ntime\n同文${deduplicate ? "" : "\n同文"}\n\n`);
});
it("没有正文的源文件直接保留，不生成伪造条目", () => {
  expect(format.render_text("\n", [], "empty.srt")).toEqual({ translated: "\n", bilingual: "\n" });
});

it("正文块分隔会截断内容，尾部换行可作为块间分隔", async () => {
  const item = create_item({
    src: "源文",
    dst: "前\n\n后",
    status: "PROCESSED",
    row: 7,
    extra_field: "00:00:01,000 --> 00:00:02,000",
  });
  expect(() => format.render_text("", [item], "sub.srt")).toThrow(
    expect.objectContaining({
      code: "file.invalid_structure",
      public_details: { file: "sub.srt", subtitle: 7 },
    }),
  );
  item.dst = "完整\n\n";
  const output = format.render_text("", [item], "sub.srt");
  expect((await format.read_from_stream(Buffer.from(output.translated), "sub.srt"))[0]?.src).toBe(
    "完整",
  );
});
