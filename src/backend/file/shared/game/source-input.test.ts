import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../../../native/native-fs";
import { resolve_game_source_input } from "./source-input";

it("目录和大小写 EXE 解析为绝对路径，带扩展名的目录仍是目录", () => {
  using temp = fs.mkdtempDisposableSync(path.join(process.cwd(), ".tmp-game-input-"));
  const native = new NativeFs();
  for (const name of ["game", "game.exe", "game.pck"]) {
    const root = path.join(temp.path, name);
    fs.mkdirSync(root);
    expect(resolve_game_source_input(path.relative(process.cwd(), root), native)).toEqual({
      root,
      executable: null,
    });
  }
  for (const name of ["Launcher.exe", "Other.EXE"]) {
    const executable = path.join(temp.path, name);
    fs.writeFileSync(executable, "");
    expect(resolve_game_source_input(path.relative(process.cwd(), executable), native)).toEqual({
      root: temp.path,
      executable,
    });
  }
});

it("其他文件和不存在的路径不能成为原生游戏入口", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-input-reject-"));
  const native = new NativeFs();
  for (const name of ["game.pck", "Game.ini", "Game.rgss3a", "text.txt"]) {
    const file = path.join(temp.path, name);
    fs.writeFileSync(file, "");
    expect(resolve_game_source_input(file, native)).toBeNull();
  }
  expect(resolve_game_source_input(path.join(temp.path, "missing"), native)).toBeNull();
  expect(resolve_game_source_input(path.join(temp.path, "missing.exe"), native)).toBeNull();
});

it("状态读取的 IO 错误交给调用方处理", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-game-input-io-"));
  const native = new NativeFs();
  const error = new Error("access denied");
  vi.spyOn(native, "stat").mockImplementation(() => {
    throw error;
  });
  expect(() => resolve_game_source_input(temp.path, native)).toThrow(error);
});
