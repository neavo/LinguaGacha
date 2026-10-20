import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import { discover_godot_source, collect_godot_files } from "./source";
import { discover_sources } from "../source-discovery";
import {
  build_resource,
  godot_pack_fixture,
  godot_project_fixture,
} from "../../../test/godot-fixture";

it.each(["directory", "exe", "pck"])(
  "%s 入口识别同一外置 PCK，扫描去重为一个游戏",
  async (kind) => {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-source-"));
    const native = new NativeFs(),
      exe = path.join(temp.path, "game.exe"),
      pck = path.join(temp.path, "game.exe.pck");
    const executable = Buffer.alloc(512);
    executable.write("MZ");
    executable.writeUInt32LE(64, 60);
    executable.write("PE\0\0", 64);
    executable.writeUInt16LE(1, 70);
    executable.write("pck", 88);
    executable.writeUInt32LE(256, 104);
    executable.writeUInt32LE(256, 108);
    fs.writeFileSync(exe, executable);
    fs.writeFileSync(
      pck,
      godot_pack_fixture(new Map([["project.binary", godot_project_fixture()]])),
    );
    const game = await discover_godot_source(
      kind === "directory" ? temp.path : kind === "exe" ? exe : pck,
      native,
    );
    expect(game?.executable).toBe(exe);
    expect(game?.carrier).toEqual({ kind: "pck", file: pck });
    expect(await discover_sources([temp.path, exe, pck], native)).toMatchObject([
      { file_type: "GODOT", source: { kind: "game" } },
    ]);
  },
);

it("多载体冲突终止整批，坏 PCK 归集失败并保留正常兄弟来源", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-conflict-"));
  const native = new NativeFs(),
    root = path.join(temp.path, "game");
  native.write_file_sync(path.join(root, "a.pck"), "bad");
  native.write_file_sync(path.join(temp.path, "text.txt"), "Hello");
  expect((await discover_sources([temp.path], native)).map((entry) => entry.source.kind)).toEqual([
    "failure",
    "file",
  ]);
  native.write_file_sync(path.join(root, "b.pck"), "bad");
  await expect(discover_sources([root], native)).rejects.toThrow("Conflicting Godot carriers");
});

it("候选漏斗保留 project.binary、脚本、场景、自定义资源与坏候选，排除素材和管理目录", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-collect-"));
  const native = new NativeFs();
  const files = new Map([
    ["project.binary", godot_project_fixture()],
    ["main.gd", Buffer.from('var text = "Hello world"')],
    ["scene.scn", build_resource("PackedScene", new Map())],
    ["data.res", build_resource("Resource", new Map())],
    ["font.res", build_resource("FontFile", new Map())],
    ["image.res", build_resource("CompressedTexture2D", new Map())],
    ["bad.res", Buffer.from("broken")],
    ["Table.RES", build_resource("Translation", new Map())],
    ["backup_lg/old.gd", Buffer.from("backup")],
    [".tmp/old.gd", Buffer.from("stage")],
  ]);
  for (const [name, bytes] of files) native.write_file_sync(path.join(temp.path, name), bytes);
  const game = {
    root: temp.path,
    executable: path.join(temp.path, "game.exe"),
    carrier: null,
    engine: "4",
  } as const;
  expect([...collect_godot_files(game, native).data.keys()].sort()).toEqual([
    "Table.RES",
    "bad.res",
    "data.res",
    "main.gd",
    "project.binary",
    "scene.scn",
  ]);
  expect(collect_godot_files(game, native).fonts.size).toBe(0);
});

it("暂存覆盖正式成员，字体映射单独收集并排除纹理与备份", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-staged-"));
  const native = new NativeFs(),
    staging = path.join(temp.path, ".tmp/staging");
  const font = Buffer.from('[remap]\ntype="FontFile"\npath="res://font.fontdata"\n');
  native.write_file_sync(path.join(temp.path, "project.binary"), "old");
  native.write_file_sync(path.join(temp.path, "scene.res"), build_resource("FontFile", new Map()));
  native.write_file_sync(path.join(temp.path, "backup_lg/old.import"), font);
  native.write_file_sync(path.join(temp.path, "texture.import"), '[remap]\ntype="Texture2D"');
  native.write_file_sync(path.join(staging, "project.binary"), godot_project_fixture());
  native.write_file_sync(path.join(staging, "scene.res"), build_resource("PackedScene", new Map()));
  native.write_file_sync(path.join(staging, "fonts/test.ttf.import"), font);
  const files = collect_godot_files(
    { root: temp.path, executable: "game.exe", carrier: null, engine: "4" },
    native,
    undefined,
    {
      staging,
      result: { writes: ["project.binary", "scene.res", "fonts/test.ttf.import"] },
    },
  );
  expect(files.data.get("project.binary")).toEqual(godot_project_fixture());
  expect(files.data.has("scene.res")).toBe(true);
  expect([...files.fonts]).toEqual([["fonts/test.ttf.import", font]]);
});
