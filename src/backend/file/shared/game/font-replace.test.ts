import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { evb_fixture } from "../../../../test/evb-fixture";
import { font_fixture } from "../../../../test/font-fixture";
import { wolf_archive_fixture } from "../../../../test/wolf-archive-fixture";
import { wolf_files, wolf_game } from "../../../../test/wolf-fixture";
import { discover_rpgmaker_source } from "../../rpgmaker-mv-mz/source";
import { read_wolf_game } from "../../wolfrpg/game-data";
import { discover_wolf_source } from "../../wolfrpg/source";
import { read_font_family_names } from "./font-name";
import { replace_game_font, type GameFontSource } from "./font-replace";
import { GamePrepareWorker } from "./prepare-worker";

const FONT = font_fixture([{ text: "Custom Gothic" }]);
const native = new NativeFs();

/** 写入夹具后按真实识别结果和同进程准备线程执行替换。 */
async function replace(
  root: string,
  files: ReadonlyMap<string, Buffer | string>,
  font = FONT,
  source = root,
): Promise<void> {
  for (const [name, bytes] of files) native.write_file_sync(path.join(root, name), bytes);
  const wolf = await discover_wolf_source(source, native);
  const game: GameFontSource = wolf
    ? { kind: "wolfrpg", game: wolf }
    : { kind: "mv_mz", game: (await discover_rpgmaker_source(source, native))! };
  await replace_game_font(
    game,
    { bytes: font, file_name: "custom.ttf", families: read_font_family_names(font) },
    native,
    new GamePrepareWorker(null, native).run,
  );
}

function read_font_fields(file: string): Record<number, string> {
  return (read_wolf_game(fs.readFileSync(file)).details as { fields: Record<number, string> })
    .fields;
}

it("WOLF 归档与字体替换一次提交，四个字体槽位写入族名并备份原 Game.dat", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-wolf-"));
  const archive = await wolf_archive_fixture(
    new Map([...wolf_files()].map(([name, bytes]): [string, Buffer] => [name.slice(5), bytes])),
  );
  await replace(temp.path, new Map([["Data.wolf", archive]]));
  expect(fs.existsSync(path.join(temp.path, "Data.wolf"))).toBe(false);
  expect(read_font_fields(path.join(temp.path, "Data/BasicData/Game.dat"))).toMatchObject({
    3: "Custom Gothic",
    4: "Custom Gothic",
    5: "Custom Gothic",
    6: "Custom Gothic",
  });
  expect(fs.readFileSync(path.join(temp.path, "custom.ttf"))).toEqual(FONT);
  expect(read_font_fields(path.join(temp.path, "backup_lg/Data/BasicData/Game.dat"))[3]).toBe(
    "字体",
  );
});

it.each([
  ["英文族名优先", true, [{ text: "カスタム", language: 0x0411 }, { text: "Custom" }], "Custom"],
  [
    "CP932 跳过无法保存的别名",
    false,
    [
      { text: "나눔고딕", language: 0x0412 },
      { text: "カスタム", language: 0x0411 },
    ],
    "カスタム",
  ],
  ["CP932 没有可保存的别名时整次失败", false, [{ text: "나눔고딕", language: 0x0412 }], null],
])("WOLF 自动选择字体名称：%s", async (_label, utf8, names, expected) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-wolf-name-"));
  const files = wolf_files();
  files.set("Data/BasicData/Game.dat", wolf_game(14, utf8));
  const game_file = path.join(temp.path, "Data/BasicData/Game.dat");
  const pending = replace(temp.path, files, font_fixture(names));
  if (expected !== null) {
    await pending;
    expect(read_font_fields(game_file)[4]).toBe(expected);
    return;
  }
  await expect(pending).rejects.toThrow("Font name cannot be stored");
  expect(fs.readFileSync(game_file)).toEqual(wolf_game(14, false));
  for (const name of ["custom.ttf", "backup_lg", ".tmp"])
    expect(fs.existsSync(path.join(temp.path, name))).toBe(false);
});

it("MV 按原路径覆盖全部字体并备份原文件，加载配置保持不变", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-mv-"));
  const css = '@font-face { font-family: GameFont; src: url("b.woff") format("woff"); }';
  await replace(
    temp.path,
    new Map([
      ["www/data/System.json", '{"gameTitle":"MV"}'],
      ["www/js/rpg_core.js", "// fixture"],
      ["www/fonts/gamefont.css", css],
      ["www/fonts/a.ttf", "old a"],
      ["www/fonts/b.woff", "old b"],
    ]),
  );
  for (const name of ["a.ttf", "b.woff"])
    expect(fs.readFileSync(path.join(temp.path, "www/fonts", name))).toEqual(FONT);
  expect(fs.readFileSync(path.join(temp.path, "www/fonts/gamefont.css"), "utf8")).toBe(css);
  expect(fs.readFileSync(path.join(temp.path, "backup_lg/www/fonts/b.woff"), "utf8")).toBe("old b");
});

it("MZ 封装游戏展开后按原路径覆盖字体", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-mz-"));
  const packed = evb_fixture(
    new Map([
      ["data/System.json", Buffer.from('{"gameTitle":"MZ"}')],
      ["js/rmmz_core.js", Buffer.from("// fixture")],
      ["fonts/main.woff2", Buffer.from("old main")],
      ["Game.exe", Buffer.from("embedded launcher")],
    ]),
  );
  await replace(temp.path, new Map([["Game.exe", packed]]), FONT, path.join(temp.path, "Game.exe"));
  expect(fs.readFileSync(path.join(temp.path, "fonts/main.woff2"))).toEqual(FONT);
  expect(fs.readFileSync(path.join(temp.path, "backup_lg/fonts/main.woff2"), "utf8")).toBe(
    "old main",
  );
});
