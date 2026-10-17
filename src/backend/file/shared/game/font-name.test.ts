import { expect, it } from "vitest";
import { font_fixture } from "../../../../test/font-fixture";
import { read_font_family_names } from "./font-name";

it("读取 Windows 平台全部语言的族名并去重，英文在前，忽略其它名称与 Mac 条目", () => {
  const font = font_fixture([
    { text: "カスタムゴシック", language: 0x0411 },
    { text: "Custom Gothic" },
    { text: "Custom Gothic", language: 0x0809 },
    { text: "Custom Gothic Bold", name_id: 4 },
    { text: "Mac Only", platform: 1 },
  ]);
  expect(read_font_family_names(font)).toEqual(["Custom Gothic", "カスタムゴシック"]);
});

it.each([
  ["非字体文件", Buffer.from("not a font file")],
  ["没有族名", font_fixture([{ text: "Full", name_id: 4 }])],
])("拒绝%s", (_label, bytes) => {
  expect(() => read_font_family_names(bytes)).toThrow();
});
