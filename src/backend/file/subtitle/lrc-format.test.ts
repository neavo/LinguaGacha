import { expect, it } from "vitest";
import { LRCFormat } from "./lrc-format";

const format = new LRCFormat({ target_language: "ZH", deduplication_in_bilingual: true });
it("逐字降级、多时间标签和多行双语写回保留元数据、offset 与文件尾", async () => {
  const text =
    "[ti:Title]\r\n[offset:-100]\r\n[00:12.30][00:45.60]<00:12.30>Hello <00:12.80>world[00:13.00]\r\n[00:50]\r\n# tail";
  const items = await format.read_from_stream(Buffer.from(text), "sub.lrc");
  expect(items.map((item) => item.src)).toEqual(["Hello world"]);
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "你好\n世界";
  const output = format.render_text(text, items, "sub.lrc");
  expect(output.translated).toBe(
    "[ti:Title]\r\n[offset:-100]\r\n[00:12.30][00:45.60]你好\r\n[00:12.30][00:45.60]世界\r\n[00:50]\r\n# tail",
  );
  expect(output.bilingual).toContain("[00:12.30][00:45.60]Hello world\r\n[00:12.30][00:45.60]你好");
});
it("同时间戳条目不合并，空译文保留时间，未完成回源，字面量换行不解释", async () => {
  const text = "[00:01]one\n[00:01]two\n[00:02]three";
  const items = await format.read_from_stream(Buffer.from(text), "sub.lrc");
  expect(items.map((item) => item.row)).toEqual([0, 1, 2]);
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "";
  items[1]!.status = "PROCESSED";
  items[1]!.dst = "二\\n行";
  items[2]!.status = "ERROR";
  items[2]!.dst = "暂存";
  const output = format.render_text(text, items, "sub.lrc");
  expect(output.translated).toBe("[00:01]\n[00:01]二\\n行\n[00:02]three");
  expect(output.bilingual).toContain("[00:01]one\n[00:01]two\n[00:01]二\\n行");
});
it("普通括号与未知元数据保留，秒越界和译文时间标签提供文件行号", async () => {
  const text = "[unknown:value]\n[1:02.3]a <05> [name] (text)";
  const items = await format.read_from_stream(Buffer.from(text), "sub.lrc");
  expect(items[0]?.src).toBe("a <05> [name] (text)");
  expect(format.render_text(text, items, "sub.lrc").translated).toBe(text);
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "bad [00:03] text";
  expect(() => format.render_text(text, items, "sub.lrc")).toThrow("sub.lrc:2:");
  await expect(
    format.read_from_stream(Buffer.from("[00:60]text"), "bad.lrc"),
  ).rejects.toMatchObject({ public_details: { file: "bad.lrc", line: 1 } });
});
it("零条目文件和原始空时间点原样输出", async () => {
  const text = "[offset:50]\n[00:01]\n# end";
  expect(await format.read_from_stream(Buffer.from(text), "empty.lrc")).toEqual([]);
  expect(format.render_text(text, [], "empty.lrc")).toEqual({ translated: text, bilingual: text });
});
