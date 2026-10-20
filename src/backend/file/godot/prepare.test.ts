import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import {
  create_godot_fixture,
  godot_pack_fixture,
  build_resource,
} from "../../../test/godot-fixture";
import { discover_godot_source } from "./source";
import { prepare_game_source } from "../shared/game/engines";
import { read_resource } from "./resource";
import { u32 } from "./binary";

it.each(["external", "embedded"])("%s 载体准备、字体回退、重复导入与原载体备份", async (kind) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-prepare-"));
  const native = new NativeFs(),
    files = create_godot_fixture();
  files.set(
    ".godot/imported/font.fontdata",
    build_resource(
      "FontFile",
      new Map([["allow_system_fallback", Buffer.concat([u32(2), u32(0)])]]),
    ),
  );
  const prefix = Buffer.alloc(256, 42),
    bytes = godot_pack_fixture(files, { prefix: kind === "embedded" ? prefix : undefined });
  const carrier = path.join(temp.path, kind === "embedded" ? "game.exe" : "game.pck");
  fs.writeFileSync(carrier, bytes);
  if (kind === "external") fs.writeFileSync(path.join(temp.path, "game.exe"), prefix);
  const game = (await discover_godot_source(path.join(temp.path, "game.exe"), native))!;
  expect(game.carrier?.kind).toBe(kind === "embedded" ? "embedded" : "pck");
  const copy = vi.spyOn(native, "copy_file");
  await prepare_game_source({ kind: "game", file_type: "GODOT", game }, native);
  expect(copy).not.toHaveBeenCalled();
  expect(
    fs.readFileSync(path.join(temp.path, "backup_lg", path.basename(carrier))).equals(bytes),
  ).toBe(true);
  expect(fs.readFileSync(path.join(temp.path, "game.exe")).equals(prefix)).toBe(true);
  expect(fs.existsSync(path.join(temp.path, "game.pck"))).toBe(false);
  expect(
    read_resource(fs.readFileSync(path.join(temp.path, ".godot/imported/font.fontdata")))
      .properties[0]!.value.value,
  ).toBe(true);
  const loose = (await discover_godot_source(temp.path, native))!;
  expect(loose.carrier).toBeNull();
  const create = vi.spyOn(native, "make_dir_exclusive");
  await prepare_game_source({ kind: "game", file_type: "GODOT", game: loose }, native);
  expect(create).not.toHaveBeenCalled();
});
