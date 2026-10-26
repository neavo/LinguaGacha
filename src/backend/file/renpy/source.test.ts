import { complete_game_preparation } from "../shared/game/preparation";
import { read_renpy_format_metadata } from "./profile";
import { RENPY_LANGUAGE_FILE, RENPY_GENERATED_MARKER } from "./generated";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { create_renpy_fixture, compiled_fixture, code_fixture } from "../../../test/renpy-fixture";
import {
  build_renpy_metadata,
  discover_renpy_source,
  collect_renpy_files,
  collect_renpy_fonts,
} from "./source";

it("游戏入口共用身份，收集时排除缓存和已生成资源", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-discover-"));
  const native = create_renpy_fixture(temp.path),
    game = (await discover_renpy_source(temp.path, native))!;
  expect(await discover_renpy_source(path.join(temp.path, "Game.exe"), native)).toEqual(game);
  expect(await discover_renpy_source(path.join(temp.path, "game"), native)).toEqual(game);
  const before = collect_renpy_files(game, native);
  const generated = path.join(temp.path, RENPY_LANGUAGE_FILE);
  native.write_file_sync(generated, RENPY_GENERATED_MARKER + "\n");
  native.write_file_sync(generated + "c", compiled_fixture());
  native.write_file_sync(path.join(temp.path, "game/cache/unused.rpyc"), "not a compiled script");
  expect(collect_renpy_files(game, native)).toEqual(before);
  native.write_file_sync(generated, "unrelated source");
  expect(() => collect_renpy_files(game, native)).toThrow("Reserved Ren'Py file conflict");
});
it("百分号语义只接受确定的初始化赋值", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-semantics-"));
  const native = create_renpy_fixture(temp.path),
    game = (await discover_renpy_source(temp.path, native))!;
  for (const [expression, context, expected] of [
    ["False", "init", false],
    ["choose_mode()", "init", null],
    ["False", "conditional", null],
    ["False", "runtime", null],
  ] as const) {
    native.write_file_sync(
      path.join(temp.path, "game/script.rpyc"),
      code_fixture("config.old_substitutions = " + expression, context),
    );
    const data = collect_renpy_files(game, native);
    expect(
      read_renpy_format_metadata(await build_renpy_metadata(game, { data, complete: true }, native))
        .old_substitutions,
    ).toBe(expected);
  }
});

it("字体来自有效暂存集合，缓存、存档和备份不进入字体或原稿", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-font-source-"));
  const native = create_renpy_fixture(temp.path);
  for (const name of [
    "game/main.ttf",
    "game/cache/cache.ttf",
    "game/saves/save.otf",
    "backup_lg/game/old.ttf",
  ])
    native.write_file_sync(path.join(temp.path, name), "loose");
  const staging = path.join(temp.path, ".tmp/stage");
  native.write_file_sync(path.join(staging, "game/main.ttf"), "prepared Type 1");
  native.write_file_sync(path.join(staging, "game/extra.OTF"), "prepared OTF");
  native.write_file_sync(path.join(temp.path, "game/script.rpyc"), "invalid compiled script");
  const files = collect_renpy_fonts(
    (await discover_renpy_source(temp.path, native))!,
    native,
    undefined,
    complete_game_preparation(staging, { writes: ["game/main.ttf", "game/extra.OTF"] }).sources,
  );
  expect([...files.fonts.keys()]).toEqual(["game/extra.OTF", "game/main.ttf"]);
  expect(Buffer.from(files.fonts.get("game/main.ttf")!).toString()).toBe("prepared Type 1");
  expect(files.data.size).toBe(0);
});
