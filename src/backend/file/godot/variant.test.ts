import { expect, it } from "vitest";
import { Reader, string, u32 } from "./binary";
import { MARSHAL_VARIANT_TYPES, read_variant, variant_string, variant_strings } from "./variant";

it("Marshal 字符串、PackedStringArray 和嵌套字典按字节对齐读取", () => {
  for (const text of ["a", "ab", "abc", "abcd", "中文🙂"]) {
    const bytes = variant_string(text),
      reader = new Reader(bytes);
    expect(read_variant(reader).value).toBe(text);
    expect(reader.at).toBe(bytes.length);
  }
  const packed = variant_strings(["one", "中文🙂"]);
  expect(read_variant(new Reader(packed)).children!.map((value) => value.value)).toEqual([
    "one",
    "中文🙂",
  ]);
  const dictionary = Buffer.concat([
    u32(27),
    u32(1),
    variant_string("key"),
    variant_string("value"),
  ]);
  expect(read_variant(new Reader(dictionary)).children!.map((value) => value.value)).toEqual([
    "key",
    "value",
  ]);
  expect(() =>
    read_variant(new Reader(Buffer.concat([u32(4), u32(100), string("short")]))),
  ).toThrow();
});

it("Marshal 数学类型按 Variant::Type 的分量数读取，64 位标志只放宽浮点分量", () => {
  const reals = {
      VECTOR2: 2,
      RECT2: 4,
      VECTOR3: 3,
      TRANSFORM2D: 6,
      VECTOR4: 4,
      PLANE: 4,
      QUATERNION: 4,
      AABB: 6,
      BASIS: 9,
      TRANSFORM3D: 12,
      PROJECTION: 16,
    },
    ints = { VECTOR2I: 2, RECT2I: 4, VECTOR3I: 3, VECTOR4I: 4 };
  const cases: [name: string, flag: number, size: number][] = [];
  for (const [name, n] of Object.entries(reals))
    cases.push([name, 0, n * 4], [name, 0x10000, n * 8]);
  for (const [name, n] of Object.entries(ints)) cases.push([name, 0, n * 4]);
  for (const [name, flag, size] of cases) {
    const reader = new Reader(
      Buffer.concat([
        u32(MARSHAL_VARIANT_TYPES.indexOf(name) | flag),
        Buffer.alloc(size),
        variant_string("next"),
      ]),
    );
    read_variant(reader);
    expect(read_variant(reader).value, name).toBe("next");
  }
});
