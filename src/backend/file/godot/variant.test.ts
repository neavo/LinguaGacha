import { expect, it } from "vitest";
import { Reader, string, u32 } from "./binary";
import { read_variant, variant_string, variant_strings } from "./variant";

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
