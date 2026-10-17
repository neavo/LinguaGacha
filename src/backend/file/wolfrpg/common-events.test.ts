import { expect, it } from "vitest";
import { wolf_common } from "../../../test/wolf-fixture";
import { assert_wolf_roundtrip } from "../../../test/wolf-roundtrip";
import { read_wolf_common } from "./common-events";

it.each([0x90, 0x91, 0x93, 0xcc])("公共事件 %i 保留未修改字节并支持变长写回", (version) => {
  const doc = assert_wolf_roundtrip(wolf_common(version), read_wolf_common);
  expect(doc.slots[0]!.location).toEqual({ kind: "common_name", event: 0 }); // 文件中的事件 ID 为 99。
});

it("截断和未知布局标记均失败", () => {
  expect(() => read_wolf_common(wolf_common().subarray(0, -1))).toThrow();
  const bad = wolf_common();
  bad[10] = 0x8f;
  expect(() => read_wolf_common(bad)).toThrow("marker");
});
