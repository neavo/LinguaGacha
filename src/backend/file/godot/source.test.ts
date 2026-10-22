import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { NativeFs } from "../../../native/native-fs";
import {
  discover_godot_source,
  collect_godot_files,
  collect_godot_fonts,
  apply_godot_pack_order,
  read_godot_pack_orders,
  create_empty_pack,
} from "./source";
import { discover_sources } from "../source-discovery";
import {
  build_resource,
  godot_executable_fixture,
  godot_pack_fixture,
  godot_project_fixture,
} from "../../../test/godot-fixture";

it("目录和 EXE 识别同一外置 PCK，包文件不能作为入口", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-source-"));
  const native = new NativeFs(),
    exe = path.join(temp.path, "game.exe"),
    pck = path.join(temp.path, "game.exe.pck");
  const executable = godot_executable_fixture();
  fs.writeFileSync(exe, executable);
  fs.writeFileSync(pck, godot_pack_fixture(new Map([["project.binary", godot_project_fixture()]])));
  const game = await discover_godot_source(temp.path, native);
  expect(game?.executable).toBe(exe);
  expect(game?.external).toMatchObject([{ file: pck }]);
  expect(await discover_godot_source(exe, native)).toEqual(game);
  expect(await discover_godot_source(pck, native)).toBeNull();
});

it("已展开目录无需 EXE，明确选择程序时保留其路径", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-loose-"));
  const native = new NativeFs();
  native.write_file_sync(path.join(temp.path, "project.binary"), godot_project_fixture());
  fs.mkdirSync(path.join(temp.path, ".godot"));
  expect(await discover_godot_source(temp.path, native)).toMatchObject({
    root: temp.path,
    embedded: null,
    external: [],
    settings_file: null,
  });
  for (const name of ["a.exe", "selected.EXE"])
    native.write_file_sync(path.join(temp.path, name), "");
  const executable = path.join(temp.path, "selected.EXE");
  expect(await discover_godot_source(executable, native)).toMatchObject({
    executable,
    embedded: null,
    external: [],
    settings_file: null,
  });
});

it("目录名带 .exe 时仍保留目录输入身份", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-directory-exe-"));
  const native = new NativeFs(),
    root = path.join(temp.path, "folder.exe");
  native.write_file_sync(
    path.join(root, "game.pck"),
    godot_pack_fixture(new Map([["project.binary", godot_project_fixture()]])),
  );
  expect((await discover_sources([root], native))[0]!.source_path).toBe(root);
});

it("多个坏 PCK 仍归集来源失败并保留正常兄弟来源", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-conflict-"));
  const native = new NativeFs(),
    root = path.join(temp.path, "game");
  native.write_file_sync(path.join(root, "a.pck"), "bad");
  native.write_file_sync(path.join(root, "b.pck"), "bad");
  native.write_file_sync(path.join(temp.path, "text.txt"), "Hello");
  expect((await discover_sources([temp.path], native)).map((entry) => entry.source.kind)).toEqual([
    "failure",
    "file",
  ]);
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
    embedded: null,
    external: [],
    settings_file: null,
  } as const;
  expect([...collect_godot_files(game, native).keys()].sort()).toEqual([
    "Table.RES",
    "bad.res",
    "data.res",
    "main.gd",
    "project.binary",
    "scene.scn",
  ]);
});

it("暂存覆盖正式成员，字体工具单独收集字体映射并排除纹理与备份", () => {
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
  const game = {
    root: temp.path,
    executable: "game.exe",
    embedded: null,
    external: [],
    settings_file: null,
  } as const;
  const prepared = {
    staging,
    result: { writes: ["project.binary", "scene.res", "fonts/test.ttf.import"] },
  };
  const data = collect_godot_files(game, native, undefined, prepared);
  expect(Buffer.from(data.get("project.binary")!).equals(godot_project_fixture())).toBe(true);
  expect(data.has("scene.res")).toBe(true);
  expect([...collect_godot_fonts(game, native, undefined, prepared).fonts]).toEqual([
    ["fonts/test.ttf.import", font],
  ]);
});

it("外部包按固定自然顺序预览，排序必须完整覆盖来源集合", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-godot-order-"));
  const native = new NativeFs();
  for (const name of ["patch10.pck", "patch2.pck", "game.pck"])
    native.write_file_sync(path.join(temp.path, name), godot_pack_fixture(new Map()));
  native.write_file_sync(path.join(temp.path, "empty.pck"), create_empty_pack());
  const game = (await discover_godot_source(temp.path, native))!;
  expect(game.external.map((carrier) => path.basename(carrier.file))).toEqual([
    "game.pck",
    "patch2.pck",
    "patch10.pck",
  ]);
  const ordered_pcks = ["patch10.pck", "patch2.pck", "game.pck"];
  expect(
    apply_godot_pack_order(game, { game_root: temp.path, ordered_pcks }).external.map((carrier) =>
      path.basename(carrier.file),
    ),
  ).toEqual(ordered_pcks);
  for (const names of [
    ["game.pck"],
    ["game.pck", "game.pck", "patch2.pck"],
    ["../game.pck", "patch2.pck", "patch10.pck"],
  ])
    expect(() =>
      apply_godot_pack_order(game, { game_root: temp.path, ordered_pcks: names }),
    ).toThrow();
  for (const value of [
    {},
    [{ game_root: temp.path, ordered_pcks: [1] }],
    [
      { game_root: temp.path, ordered_pcks: [] },
      { game_root: temp.path, ordered_pcks: [] },
    ],
  ])
    expect(() => read_godot_pack_orders(value)).toThrow();
});
