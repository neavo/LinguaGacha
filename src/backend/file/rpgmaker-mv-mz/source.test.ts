import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { collect_rpgmaker_files, discover_rpgmaker_source } from "./source";

it.each(["", "www"])("目录和可执行文件识别同一游戏，仅收集数据与插件：%s", async (prefix) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rm-source-"));
  const files = [
    "data/System.json",
    "data/nested/Map.json",
    "js/rmmz_core.js",
    "js/plugins.js",
    "js/plugins/menu.js",
    "img/title.png",
  ];
  for (const file of [...files.map((file) => path.join(prefix, file)), "Game.exe"]) {
    const target = path.join(temp.path, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "");
  }
  const native = new NativeFs();
  const game = (await discover_rpgmaker_source(temp.path, native))!;
  expect(await discover_rpgmaker_source(path.join(temp.path, "Game.exe"), native)).toEqual(game);
  expect(
    collect_rpgmaker_files(
      game,
      files.map((file) => [prefix, file].filter(Boolean).join("/")),
    ),
  ).toEqual(
    ["data/nested/Map.json", "data/System.json", "js/plugins.js", "js/plugins/menu.js"].map(
      (file) => [prefix, file].filter(Boolean).join("/"),
    ),
  );
  expect(
    await discover_rpgmaker_source(path.join(temp.path, prefix, "data/System.json"), native),
  ).toBeNull();
});
