import { expect, it } from "vitest";
import { wolf_game } from "../../../test/wolf-fixture";
import { assert_wolf_roundtrip } from "../../../test/wolf-roundtrip";
import { read_wolf_game } from "./game-data";

it.each([8, 9, 13, 14])("游戏设置字符串数量 %i 保留未修改字节并支持变长写回", (version) => {
  const doc = assert_wolf_roundtrip(wolf_game(version), read_wolf_game);
  expect(doc.slots[0]).toMatchObject({ text: "主标题", usage: "metadata" });
});

it("拒绝未知字符串数量", () => {
  expect(() => read_wolf_game(wolf_game(10))).toThrow("count");
});
