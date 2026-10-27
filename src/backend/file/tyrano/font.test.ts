import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { write_tyrano_app } from "../../../test/tyrano-fixture";
import { collect_tyrano_fonts, tyrano_font_outputs } from "./font";
import type { TyranoSource } from "./source";

const FONT = { bytes: Buffer.from("font"), file_name: "a.ttf", families: ["A"] };

it("重复替换只保留一行样式导入，BOM 仍在文件开头", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-tyrano-font-"));
  const native = new NativeFs();
  const game: TyranoSource = {
    root: temp.path,
    app: "",
    archive: null,
    syntax: { parser: "modern", keep_space: "" },
  };
  const bom = String.fromCharCode(0xfeff);
  write_tyrano_app(native, temp.path, {
    "tyrano/tyrano.css": bom + '@import url("./css/font.css");\n',
  });
  for (let round = 0; round < 2; round++)
    for (const [name, bytes] of tyrano_font_outputs(game, collect_tyrano_fonts(game, native), FONT))
      native.write_file_sync(path.join(temp.path, name), bytes);
  expect(native.read_text_file(path.join(temp.path, "tyrano/tyrano.css"))).toBe(
    bom + '@import url("./css/linguagacha-font.css");\n@import url("./css/font.css");\n',
  );
  expect(native.read_text_file(path.join(temp.path, "tyrano/css/linguagacha-font.ttf"))).toBe(
    "font",
  );
});

it("游戏自带同名字体文件按冲突处理", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-tyrano-font-conflict-"));
  const native = new NativeFs();
  const game: TyranoSource = {
    root: temp.path,
    app: "",
    archive: null,
    syntax: { parser: "modern", keep_space: "" },
  };
  write_tyrano_app(native, temp.path, { "tyrano/css/linguagacha-font.css": "body {}" });
  expect(() => collect_tyrano_fonts(game, native)).toThrow(
    /conflicts with LinguaGacha font files/u,
  );
});
