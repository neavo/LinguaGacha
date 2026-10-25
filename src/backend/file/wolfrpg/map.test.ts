import { expect, it } from "vitest";
import { wolf_map } from "../../../test/wolf-fixture";
import { assert_wolf_roundtrip } from "../../../test/wolf-roundtrip";
import { read_wolf_map } from "./map";
import { wolf_vectors, wolf_vector } from "../../../test/wolf-vectors";
it.each([0x64, 0x65, 0x66, 0x67])("地图 %i 保留未修改字节并支持变长写回", (version) => {
  const doc = assert_wolf_roundtrip(wolf_map(version), read_wolf_map);
  expect(doc.slots[0]!.location).toEqual({ kind: "map_name", event: 0 }); // 文件中的事件 ID 为 77，定位使用物理位置。
});

it("CP932 地图的首图块可以是 0xffffffff", () => {
  const doc = read_wolf_map(wolf_vector(wolf_vectors.map));
  expect(doc.details).toMatchObject({ width: 1, height: 1, events: [] });
});
