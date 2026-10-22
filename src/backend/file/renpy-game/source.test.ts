import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { create_renpy_fixture, compiled_fixture, code_fixture } from "../../../test/renpy-fixture";
import {
  discover_renpy_source,
  collect_renpy_files,
  RENPY_GENERATED_FILES,
  RENPY_GENERATED_MARKER,
} from "./source";

it("游戏入口共用身份，收集时排除缓存和已生成资源", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-discover-"));
  const native = create_renpy_fixture(temp.path),
    game = (await discover_renpy_source(temp.path, native))!;
  expect(await discover_renpy_source(path.join(temp.path, "Game.exe"), native)).toEqual(game);
  expect(await discover_renpy_source(path.join(temp.path, "game"), native)).toEqual(game);
  const before = (await collect_renpy_files(game, native)).data;
  const generated = path.join(temp.path, RENPY_GENERATED_FILES[0]);
  native.write_file_sync(generated, RENPY_GENERATED_MARKER + "\n");
  native.write_file_sync(generated + "c", compiled_fixture());
  native.write_file_sync(path.join(temp.path, "game/cache/unused.rpyc"), "not a compiled script");
  expect((await collect_renpy_files(game, native)).data).toEqual(before);
  native.write_file_sync(generated, "unrelated source");
  await expect(async () => await collect_renpy_files(game, native)).rejects.toThrow(
    "Reserved Ren'Py file conflict",
  );
});
it("游戏百分号语义随原稿固化，动态赋值保留未知状态", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-semantics-"));
  const native = create_renpy_fixture(temp.path),
    game = (await discover_renpy_source(temp.path, native))!;
  for (const [expression, expected] of [
    ["False", false],
    ["choose_mode()", null],
  ] as const) {
    native.write_file_sync(
      path.join(temp.path, "game/script.rpyc"),
      code_fixture("config.old_substitutions = " + expression),
    );
    const files = await collect_renpy_files(game, native);
    expect(JSON.parse(Buffer.from(files.metadata!).toString()).profile.old_substitutions).toBe(
      expected,
    );
  }
});

it("条件或剧情中的百分号设置记录为未知语义", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-renpy-percent-"));
  const native = create_renpy_fixture(temp.path),
    game = (await discover_renpy_source(temp.path, native))!;
  for (const context of ["conditional", "runtime"] as const) {
    native.write_file_sync(
      path.join(temp.path, "game/script.rpyc"),
      code_fixture("config.old_substitutions = False", context),
    );
    const files = await collect_renpy_files(game, native);
    expect(
      JSON.parse(Buffer.from(files.metadata!).toString()).profile.old_substitutions,
    ).toBeNull();
  }
});
