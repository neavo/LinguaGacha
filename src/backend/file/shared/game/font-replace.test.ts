import { GameDirectoryOperations } from "./game-directory-operations";
import type { GameSource } from "./engines";
import { FileFormatService } from "../../file-format-service";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { evb_fixture } from "../../../../test/evb-fixture";
import { font_fixture } from "../../../../test/font-fixture";
import { encrypted_media, MEDIA_KEY, png_fixture } from "../../../../test/media-fixture";
import { wolf_archive_fixture } from "../../../../test/wolf-archive-fixture";
import { wolf_files, wolf_game } from "../../../../test/wolf-fixture";
import { discover_rpgmaker_source } from "../../rpgmaker-mv-mz/source";
import { read_wolf_game } from "../../wolfrpg/game-data";
import { discover_wolf_source } from "../../wolfrpg/source";
import { read_font_family_names } from "./font-name";
import { replace_game_font } from "./font-replace";
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
  const game: GameSource = wolf
    ? { kind: "game", file_type: "WOLFRPG", game: wolf }
    : {
        kind: "game",
        file_type: "RPGMAKER_MV_MZ",
        game: (await discover_rpgmaker_source(source, native))!,
      };
  await replace_game_font(
    game,
    { bytes: font, file_name: "custom.ttf", families: read_font_family_names(font) },
    native,
    new GamePrepareWorker(null, native).run,
  );
}

/** 从落盘字节核对字体槽位，覆盖暂存到正式目录的提交结果。 */
function read_font_fields(file: string): Record<number, string> {
  return (read_wolf_game(fs.readFileSync(file)).details as { fields: Record<number, string> })
    .fields;
}

it("WOLF 归档与字体替换一次提交，四个字体槽位写入族名", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-wolf-"));
  const archive = await wolf_archive_fixture(
    new Map([...wolf_files()].map(([name, bytes]): [string, Buffer] => [name.slice(5), bytes])),
  );
  await replace(
    temp.path,
    new Map<string, Buffer | string>([
      ["Data.wolf", archive],
      ["Fonts/config.txt", "font config"],
      ["CUSTOM.TTF", "old root font"],
    ]),
  );
  expect(fs.existsSync(path.join(temp.path, "Data.wolf"))).toBe(false);
  expect(read_font_fields(path.join(temp.path, "Data/BasicData/Game.dat"))).toMatchObject({
    3: "Custom Gothic",
    4: "Custom Gothic",
    5: "Custom Gothic",
    6: "Custom Gothic",
  });
  expect(fs.readFileSync(path.join(temp.path, "CUSTOM.TTF")).equals(FONT)).toBe(true);
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
  expect(fs.readFileSync(game_file).equals(wolf_game(14, false))).toBe(true);
  for (const name of ["custom.ttf", "backup_lg", ".tmp"])
    expect(fs.existsSync(path.join(temp.path, name))).toBe(false);
});

it("MV 媒体清理与字体覆盖一次提交，保留加载配置", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-mv-"));
  const css = '@font-face { font-family: GameFont; src: url("b.woff") format("woff"); }';
  await replace(
    temp.path,
    new Map<string, Buffer | string>([
      [
        "www/data/System.json",
        JSON.stringify({ gameTitle: "MV", hasEncryptedImages: true, encryptionKey: MEDIA_KEY }),
      ],
      ["www/js/rpg_core.js", "// fixture"],
      ["www/img/a.rpgmvp", encrypted_media(png_fixture())],
      ["www/fonts/gamefont.css", css],
      ["www/fonts/a.ttf", "old a"],
      ["www/fonts/b.woff", "old b"],
    ]),
  );
  expect(fs.readFileSync(path.join(temp.path, "www/img/a.png")).equals(png_fixture())).toBe(true);
  expect(fs.existsSync(path.join(temp.path, "www/img/a.rpgmvp"))).toBe(false);
  for (const name of ["a.ttf", "b.woff"])
    expect(fs.readFileSync(path.join(temp.path, "www/fonts", name)).equals(FONT)).toBe(true);
  expect(fs.readFileSync(path.join(temp.path, "www/fonts/gamefont.css"), "utf8")).toBe(css);
});

it("MZ 封装游戏展开后按原路径覆盖字体", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-mz-"));
  const packed = evb_fixture(
    new Map([
      [
        "data/System.json",
        Buffer.from(
          JSON.stringify({ gameTitle: "MZ", hasEncryptedImages: true, encryptionKey: MEDIA_KEY }),
        ),
      ],
      ["js/rmmz_core.js", Buffer.from("// fixture")],
      ["img/a.png_", encrypted_media(png_fixture())],
      ["fonts/main.woff2", Buffer.from("old main")],
      ["Game.exe", Buffer.from("embedded launcher")],
    ]),
  );
  await replace(temp.path, new Map([["Game.exe", packed]]), FONT, path.join(temp.path, "Game.exe"));
  expect(fs.readFileSync(path.join(temp.path, "fonts/main.woff2")).equals(FONT)).toBe(true);
  expect(fs.readFileSync(path.join(temp.path, "img/a.png")).equals(png_fixture())).toBe(true);
  expect(fs.existsSync(path.join(temp.path, "img/a.png_"))).toBe(false);
});

it.each(["mv", "mz", "wolfrpg"] as const)("%s 反复导入和替换字体", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-import-"));
  const prefix = kind === "mv" ? "www/" : "";
  const font_path = kind === "wolfrpg" ? "custom.ttf" : prefix + "fonts/main.ttf";
  const data_path = kind === "wolfrpg" ? "Data/BasicData/Game.dat" : prefix + "data/System.json";
  const files =
    kind === "wolfrpg"
      ? wolf_files()
      : new Map([
          [prefix + "data/System.json", Buffer.from("{}")],
          [
            prefix + "js/" + (kind === "mv" ? "rpg_core.js" : "rmmz_core.js"),
            Buffer.from("// fixture"),
          ],
        ]);
  files.set(font_path, Buffer.from("original font"));
  for (const [name, bytes] of files) native.write_file_sync(path.join(temp.path, name), bytes);
  const service = new FileFormatService(
    new GameDirectoryOperations(),
    { target_language: "ZH" },
    async () => null,
    native,
  );
  const entry = (await service.collect_source_file_entries([temp.path]))[0]!;
  await service.prepare_source(entry);
  await replace(temp.path, new Map());
  expect(fs.readFileSync(path.join(temp.path, font_path)).equals(FONT)).toBe(true);
  if (kind !== "wolfrpg")
    native.write_file_sync(
      path.join(temp.path, prefix + "data/System.json"),
      '{"gameTitle":"updated"}',
    );
  await service.prepare_source(entry);
  const next_font = font_fixture([{ text: "Second Font With Longer Name" }]);
  await replace(temp.path, new Map(), next_font);
  expect(fs.readFileSync(path.join(temp.path, font_path)).equals(next_font)).toBe(true);
  if (kind === "wolfrpg")
    expect(read_font_fields(path.join(temp.path, data_path))[3]).toBe(
      "Second Font With Longer Name",
    );
});

it.each(["commit", "cancel"])("字体修改 %s 失败时恢复原游戏", async (phase) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-font-failure-"));
  const local = new NativeFs();
  const originals = new Map([
    ["data/System.json", JSON.stringify({ hasEncryptedImages: true, encryptionKey: MEDIA_KEY })],
    ["js/rmmz_core.js", "// fixture"],
    ["fonts/main.ttf", "old font"],
    ["img/a.png", "old plaintext"],
  ]);
  for (const [name, text] of originals) local.write_file_sync(path.join(temp.path, name), text);
  const encrypted = path.join(temp.path, "img/a.png_");
  local.write_file_sync(encrypted, encrypted_media(png_fixture()));
  const source: GameSource = {
    kind: "game",
    file_type: "RPGMAKER_MV_MZ",
    game: (await discover_rpgmaker_source(temp.path, local))!,
  };
  const controller = new AbortController();
  const rename = local.rename.bind(local);
  vi.spyOn(local, "rename").mockImplementation((from, to) => {
    const removing = from === encrypted && to.includes(path.join(".tmp", "rollback"));
    if (removing && phase === "commit") throw new Error("commit failure");
    rename(from, to);
    if (removing) controller.abort(new Error("cancel failure"));
  });
  await expect(
    replace_game_font(
      source,
      { bytes: FONT, file_name: "custom.ttf", families: ["Custom Gothic"] },
      local,
      new GamePrepareWorker(null, local).run,
      controller.signal,
    ),
  ).rejects.toThrow(phase + " failure");
  for (const [name, text] of originals)
    expect(fs.readFileSync(path.join(temp.path, name), "utf8")).toBe(text);
  expect(fs.readFileSync(encrypted).equals(encrypted_media(png_fixture()))).toBe(true);
  expect(fs.existsSync(path.join(temp.path, ".tmp"))).toBe(false);
});
