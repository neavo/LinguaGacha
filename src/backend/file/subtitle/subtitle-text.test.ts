import { expect, it } from "vitest";
import { bind_subtitle_items, create_subtitle_items, read_subtitle_target } from "./subtitle-text";

it("正文位置跨行结束符保持一致，写回拒绝失配或重复引用", () => {
  const text = "head\r\n甲\r乙\n";
  const slots = [
    { offset: 6, text: "甲" },
    { offset: 8, text: "乙" },
  ];
  const items = create_subtitle_items(text, slots, "sub.vtt", "VTT");
  expect(items.map((item) => item.row)).toEqual([1, 2]);
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "";
  const bound = bind_subtitle_items(slots, items, "sub.vtt");
  expect(read_subtitle_target(slots[0]!, bound)).toBe("");
  expect(read_subtitle_target(slots[1]!, bound)).toBe("乙");
  expect(() => bind_subtitle_items(slots, [items[0]!, items[0]!], "sub.vtt")).toThrow("sub.vtt:2:");
  items[0]!.extra_field = { subtitle: { offset: 8 } };
  expect(() => bind_subtitle_items(slots, items, "sub.vtt")).toThrow("sub.vtt:2:");
});
