import { expect, it } from "vitest";
import { wolf_tileset } from "../../../test/wolf-fixture";
import { assert_wolf_roundtrip } from "../../../test/wolf-roundtrip";
import { read_wolf_tileset } from "./tileset";

it.each([0xd2, 0xd3])("图块设置 %i 保留未修改字节并支持变长写回", (version) => {
  const doc = assert_wolf_roundtrip(wolf_tileset(version), read_wolf_tileset);
  expect(doc.slots.every((slot) => slot.usage === "metadata")).toBe(true);
});
