import { expect, it } from "vitest";
import { base, decode, encode } from "./marshal";
import { array, text, replace_text } from "./value";

// Ruby Marshal.dump(s="source"; [s,s,s])，独立 wire 夹具同时约束引用表顺序与编码包装。
const aliases = Buffer.from("04085b0849220b736f75726365063a06455440064006", "hex");
// 由独立 Ruby Marshal.dump 生成，覆盖循环、数值表示、自定义载荷、编码和实例变量。
const ruby_fixtures = {
  cycles: "04085b075b0640067b063a0973656c664007",
  numbers:
    "04085b0b6c2b0b0000000000000000000001006c2d0b00000000000000000000010066063066072d3066086e616e6608696e66",
  opaque: "0408753a0a5461626c6509010200ff",
  encodings:
    "04085b0849220b93fa967b8cea063a0d656e636f64696e67221057696e646f77732d33314a49220a6173636969063a0645462207ff00",
  variables: "0408495b0749220a68656c6c6f073a0645543a09407461674922096d657461063b00544006063b066911",
};
it.each(Object.entries(ruby_fixtures))("独立 Ruby 协议夹具逐字节往返：%s", (_name, hex) => {
  const original = Buffer.from(hex, "hex");
  expect(encode(decode(original))).toEqual(original);
});
it("保留 Ruby 字节与共享引用，替换首个位置后其他位置仍共享原字符串", () => {
  const root = decode(aliases);
  expect(encode(root)).toEqual(aliases);
  array(root)[0] = replace_text(array(root)[0]!, "中文");
  const output = decode(encode(root));
  expect(array(output).map(text)).toEqual(["中文", "source", "source"]);
  expect(base(array(output)[1]!)).toBe(base(array(output)[2]!));
  expect(base(array(output)[0]!)).not.toBe(base(array(output)[1]!));
});
it.each(["04084000", "04083b00", "0408220b61", "04085bfa", "04083000"])(
  "拒绝无效引用、长度及尾部字节：%s",
  (hex) => {
    expect(() => decode(Buffer.from(hex, "hex"))).toThrow();
  },
);
