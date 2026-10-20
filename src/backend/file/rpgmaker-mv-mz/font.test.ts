import { expect, it } from "vitest";
import { mv_mz_font_outputs } from "./font";
import type { RPGMakerSource } from "./source";

const game: RPGMakerSource = { root: "/game", data_root: "/game/www", engine: "mv" };
const font = { bytes: new Uint8Array([7]), file_name: "custom.ttf", families: [] };

it("MV 字体输出只覆盖 data_root/fonts 下的字体文件", () => {
  const outputs = mv_mz_font_outputs(
    game,
    new Map([
      ["www/fonts/a.ttf", new Uint8Array([1])],
      ["www/fonts/b.woff", new Uint8Array([2])],
      ["www/img/x.png", new Uint8Array([3])],
    ]),
    font,
  );
  expect([...outputs.keys()]).toEqual(["www/fonts/a.ttf", "www/fonts/b.woff"]);
  expect(outputs.get("www/fonts/b.woff")).toEqual(font.bytes);
});

it("MV 缺少字体目录时失败，不写出任何文件", () => {
  expect(() => mv_mz_font_outputs(game, new Map(), font)).toThrow("No font files found");
});
