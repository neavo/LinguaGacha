import { normalize_wolf_descriptions, encode_wolf_string } from "./binary";
import { wolf_vectors, wolf_vector } from "../../../test/wolf-vectors";
import { expect, it } from "vitest";
import { wolf_common, wolf_literal } from "../../../test/wolf-fixture";
import { assert_wolf_roundtrip } from "../../../test/wolf-roundtrip";
import { read_wolf_common } from "./common-events";
it.each([0x90, 0x91, 0xc9, 0x93, 0xcc])("公共事件 %i 保留未修改字节并支持变长写回", (version) => {
  const doc = assert_wolf_roundtrip(wolf_common(version), read_wolf_common);
  expect(doc.slots[0]!.location).toEqual({ kind: "common_name", event: 0 }); // 文件中的事件 ID 为 99。
});

it("截断和未知布局标记均失败", () => {
  expect(() => read_wolf_common(wolf_common().subarray(0, -1))).toThrow();
  const bad = wolf_common();
  bad[10] = 0x8f;
  expect(() => read_wolf_common(bad)).toThrow("marker");
});

it("公共事件只清理第二个说明字符串，保留其它字段字节", () => {
  const doc = read_wolf_common(wolf_vector(wolf_vectors.descriptions.common)),
    field = doc.descriptions![0]!;
  expect(doc.details.events[0]!.description).toBe("保護\u0001\0\u001f説明\n");
  const result = normalize_wolf_descriptions(doc);
  expect(
    Buffer.from(result).equals(
      Buffer.concat([
        doc.bytes.subarray(0, field.start),
        encode_wolf_string("保護説明\n", doc.utf8),
        doc.bytes.subarray(field.end),
      ]),
    ),
  ).toBe(true);
  expect(read_wolf_common(result).details.events[0]!.description).toBe("保護説明\n");
});

it("压缩公共事件规范化保留版本、LF、CR，并只在内容变化时重新压缩", () => {
  const doc = read_wolf_common(wolf_common(0xcc)),
    field = doc.descriptions![0]!;
  const description = encode_wolf_string("说明\t\n\r", true);
  const bytes = Buffer.concat([
    doc.bytes.subarray(0, field.start),
    description,
    doc.bytes.subarray(field.end),
  ]);
  const body = bytes.subarray(11),
    packed = wolf_literal(body),
    sizes = Buffer.alloc(8);
  sizes.writeUInt32LE(body.length);
  sizes.writeUInt32LE(packed.length, 4);
  const source = Buffer.concat([bytes.subarray(0, 11), sizes, packed]);
  const normalized = read_wolf_common(normalize_wolf_descriptions(read_wolf_common(source)));
  expect(normalized.details).toMatchObject({
    version: 0xcc,
    events: [{ description: "说明\n\r" }],
  });
  expect(normalized.slots.map((slot) => slot.text)).toEqual(doc.slots.map((slot) => slot.text));
  expect(normalize_wolf_descriptions(normalized)).toBe(normalized.original);
});
