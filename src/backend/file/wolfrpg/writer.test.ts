import { expect, it } from "vitest";
import { wolf_map } from "../../../test/wolf-fixture";
import { read_wolf_map } from "./map";
import { extract_wolf_items } from "./item";
import { write_wolf_items } from "./writer";

it("物理事件位置、指令码和原文共同校验，重排与重复原文不会串写", () => {
  const bytes = wolf_map(),
    doc = read_wolf_map(bytes),
    file = "Data/MapData/Map001.mps";
  const items = extract_wolf_items(doc, file).filter((item) => item.src === "重复");
  items[0]!.status = "PROCESSED";
  items[0]!.dst = "第一条";
  items[0]!.row = 999;
  items[1]!.status = "PROCESSED";
  items[1]!.dst = "第二条";
  items[1]!.row = 0;
  const changed = read_wolf_map(write_wolf_items(doc, file, items.toReversed()));
  expect(changed.slots.slice(-2).map((slot) => slot.text)).toEqual(["第一条", "第二条"]);
  expect(() => write_wolf_items(doc, file, [...items, { ...items[0]!, dst: "冲突" }])).toThrow(
    "Conflicting",
  );
  expect(() => write_wolf_items(doc, file, [{ ...items[0]!, src: "失效" }])).toThrow("Stale");
});
