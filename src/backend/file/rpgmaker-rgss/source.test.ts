import { expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NativeFs } from "../../../native/native-fs";
import { rgss_archive_fixture } from "../../../test/rgss-archive-fixture";
import { script_path, read_rgss_game, discover_rgss_source } from "./source";
import { read_game_container } from "../shared/game/format";
import { write_zip } from "../../../test/zip-fixture";

it("通过目录或 EXE 发现归档，配置和归档不能作为入口", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-input-"));
  const native = new NativeFs();
  const ini = path.join(temp.path, "Game.ini");
  const archive = path.join(temp.path, "Game.rgss3a");
  fs.writeFileSync(ini, "[Game]\nScripts=Data/Scripts.rvdata2");
  fs.writeFileSync(archive, rgss_archive_fixture(3, new Map()));
  const game = discover_rgss_source(temp.path, native);
  expect(game).toEqual({ root: temp.path, version: "ace", archive: "Game.rgss3a" });
  const exe = path.join(temp.path, "Game.EXE");
  fs.writeFileSync(exe, "");
  expect(discover_rgss_source(exe, native)).toEqual(game);
  expect(discover_rgss_source(ini, native)).toBeNull();
  expect(discover_rgss_source(archive, native)).toBeNull();
});

it.each(["read", "decode", "header", "missing"])("RGSS %s 失败保留候选与具体原因", (failure) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-rgss-discovery-"));
  const root = path.join(temp.path, "game");
  fs.mkdirSync(root);
  const ini = path.join(root, "Game.ini");
  if (failure !== "missing")
    fs.writeFileSync(
      ini,
      failure === "decode"
        ? Buffer.from([0x81])
        : Buffer.from("[Game]\nScripts=Data/Scripts.rvdata2"),
    );
  const archive = path.join(root, "Game.rgss3a");
  fs.writeFileSync(
    archive,
    failure === "header" ? Buffer.from("broken") : rgss_archive_fixture(3, new Map()),
  );
  const native = new NativeFs();
  if (failure === "read") {
    const read = native.read_file.bind(native);
    vi.spyOn(native, "read_file").mockImplementation((file) => {
      if (file === ini) throw new Error("configuration access denied");
      return read(file);
    });
  }
  expect(() => discover_rgss_source(root, native)).toThrow(
    failure === "read"
      ? /configuration access denied/u
      : failure === "decode"
        ? /cp932/u
        : failure === "header"
          ? /header/u
          : /ENOENT/u,
  );
  expect(fs.existsSync(archive)).toBe(true);
  expect(fs.existsSync(path.join(root, "backup"))).toBe(false);
});

it.each(["../Scripts.rvdata2", "C:\\Scripts.rvdata2", "Data/Scripts.rxdata"])(
  "拒绝配置中的越界路径和版本冲突：%s",
  (value) => {
    expect(() => script_path(Buffer.from("[Game]\nScripts=" + value), "ace")).toThrow();
  },
);
it("容器按当前系统确定代际，附带旧代际资源仍可保留", async () => {
  const { members: files } = await read_game_container(
    await write_zip(
      new Map([
        ["Game.ini", "[Game]"],
        ["Data/System.rvdata2", ""],
        ["Data/Actors.rxdata", ""],
      ]),
    ),
    "game.zip",
  );
  await expect(read_rgss_game(files)).resolves.toMatchObject({ version: "ace" });
});
