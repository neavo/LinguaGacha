import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { GAME_ENGINES, type GameSource } from "./engines";

it.each(["", "www"])("MV/MZ 合并暂存、移除清单并递归保留字体配套文件：%s", async (prefix) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-files-mv-"));
  const native = new NativeFs();
  const local = (name: string) => [prefix, name].filter(Boolean).join("/");
  const originals = [
    "data/System.json",
    "data/Removed.json",
    "js/plugins.js",
    "js/plugins/Menu.js",
    "Fonts/Main.ttf",
    "Fonts/css/game.css",
    "img/a.png",
  ];
  for (const name of originals)
    native.write_file_sync(path.join(temp.path, local(name)), "old " + name);
  const staging = path.join(temp.path, ".tmp/stage");
  native.write_file_sync(path.join(staging, local("data/System.json")), "prepared data");
  native.write_file_sync(path.join(staging, local("Fonts/Main.ttf")), "prepared font");
  native.write_file_sync(path.join(staging, local("Fonts/new/config.css")), "prepared config");
  const files = await GAME_ENGINES.RPGMAKER_MV_MZ.collect(
    {
      kind: "game",
      file_type: "RPGMAKER_MV_MZ",
      game: { root: temp.path, data_root: path.join(temp.path, prefix), engine: "mz" },
    },
    native,
    undefined,
    {
      staging,
      result: {
        writes: ["data/System.json", "Fonts/Main.ttf", "Fonts/new/config.css"].map(local),
        removes: [local("data/Removed.json")],
      },
    },
  );
  expect([...files.data.keys()]).toEqual(
    ["data/System.json", "js/plugins.js", "js/plugins/Menu.js"].map(local).sort(),
  );
  expect([...files.fonts.keys()].sort()).toEqual(
    ["Fonts/Main.ttf", "Fonts/css/game.css", "Fonts/new/config.css"].map(local).sort(),
  );
  expect(Buffer.from(files.data.get(local("data/System.json"))!).toString()).toBe("prepared data");
  expect(Buffer.from(files.fonts.get(local("Fonts/Main.ttf"))!).toString()).toBe("prepared font");
});

it.each(["Data", "Custom"])("RGSS 收集 %s 配置脚本并复用已枚举的数据目录", async (directory) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-files-rgss-"));
  const native = new NativeFs();
  const script = directory + "/Main.rvdata2";
  const ini = "[Game]\nScripts=" + directory + "/main.rvdata2";
  native.write_file_sync(path.join(temp.path, "Game.ini"), ini);
  for (const name of [
    "Data/System.rvdata2",
    "Data/nested/Actor.rvdata2",
    script,
    "Fonts/Main.ttf",
    "Fonts/nested/config.txt",
    "Graphics/a.png",
  ])
    native.write_file_sync(path.join(temp.path, name), name);
  const source: GameSource = {
    kind: "game",
    file_type: "RPGMAKER_RGSS",
    game: { root: temp.path, version: "ace", archive: null },
  };
  const staging = path.join(temp.path, ".tmp/stage");
  native.write_file_sync(path.join(staging, script), "prepared script");
  const enumerate = vi.spyOn(native, "read_dirents");
  const read = vi.spyOn(native, "read_file");
  const files = await GAME_ENGINES.RPGMAKER_RGSS.collect(source, native, undefined, {
    staging,
    result: { writes: [script] },
  });
  expect([...files.data.keys()].sort()).toEqual(
    ["Game.ini", "Data/System.rvdata2", "Data/nested/Actor.rvdata2", script].sort(),
  );
  expect(Buffer.from(files.data.get(script)!).equals(Buffer.from("prepared script"))).toBe(true);
  expect(
    read.mock.calls.filter(([name]) => name === path.join(temp.path, "Game.ini")),
  ).toHaveLength(1);
  expect([...files.fonts.keys()].sort()).toEqual(["Fonts/Main.ttf", "Fonts/nested/config.txt"]);
  // 数据目录已完整收集，配置脚本应复用清单，避免再次扫描。
  expect(
    enumerate.mock.calls.filter(([name]) => name === path.join(temp.path, "Data")),
  ).toHaveLength(1);
  fs.unlinkSync(path.join(temp.path, script));
  await expect(
    async () => await GAME_ENGINES.RPGMAKER_RGSS.collect(source, native),
  ).rejects.toThrow("Missing game source file");
});

it("WOLF 收集原稿与字体，无关素材只参与目录枚举", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-source-files-wolf-"));
  const native = new NativeFs();
  for (const name of [
    "Data/BasicData/Game.dat",
    "Data/BasicData/Database.project",
    "Data/MapData/a.mps",
    "Data/Picture/a.png",
    "Data/Sound/a.ogg",
    "Fonts/nested/config.txt",
    "Data/Fonts/Main.ttf",
    "CUSTOM.TTF",
    "Game.exe",
  ])
    native.write_file_sync(path.join(temp.path, name), name);
  const materials = new Set(
    ["Data/Picture/a.png", "Data/Sound/a.ogg"].map((name) => path.join(temp.path, name)),
  );
  const accesses = (["stat", "lstat", "read_file"] as const).map((name) => vi.spyOn(native, name));
  const files = await GAME_ENGINES.WOLFRPG.collect(
    {
      kind: "game",
      file_type: "WOLFRPG",
      game: {
        root: temp.path,
        data_root: path.join(temp.path, "Data"),
        archives: [],
        key_files: [],
      },
    },
    native,
  );
  expect([...files.data.keys()]).toEqual([
    "Data/BasicData/Database.project",
    "Data/BasicData/Game.dat",
    "Data/MapData/a.mps",
  ]);
  expect([...files.fonts.keys()].sort()).toEqual([
    "CUSTOM.TTF",
    "Data/Fonts/Main.ttf",
    "Fonts/nested/config.txt",
  ]);
  for (const access of accesses)
    expect(access.mock.calls.some(([file]) => materials.has(file))).toBe(false);
});
