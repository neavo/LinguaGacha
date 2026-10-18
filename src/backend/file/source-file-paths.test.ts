import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeFs } from "../../native/native-fs";
import {
  assert_source_file_paths,
  source_file_output_path,
  SourceFilePathIndex,
  validate_game_path,
  assert_game_path_spellings,
  collect_existing_files,
  sort_game_paths,
} from "./source-file-paths";

it("原稿路径排序保持逐级目录顺序", () => {
  expect(
    sort_game_paths(["Data/a.json", "Data/a/z.json", "Data/System.json", "Data/a/A.json"]),
  ).toEqual(["Data/a/A.json", "Data/a/z.json", "Data/a.json", "Data/System.json"]);
});

it("已有文件收集保留嵌套枚举顺序、初始文件、缺失目标和原集合", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-collect-"));
  fs.mkdirSync(path.join(temp.path, "Data/nested"), { recursive: true });
  fs.writeFileSync(path.join(temp.path, "Data/a.txt"), "a");
  fs.writeFileSync(path.join(temp.path, "Data/nested/b.txt"), "b");
  const native = new NativeFs();
  const files = new Set(["existing"]);
  collect_existing_files(temp.path, "Data", files, native);
  collect_existing_files(temp.path, "missing", files, native);
  expect([...files]).toEqual(["existing", "Data/a.txt", "Data/nested/b.txt"]);
  const single = new Set<string>();
  collect_existing_files(temp.path, "Data/a.txt", single, native);
  expect([...single]).toEqual(["Data/a.txt"]);
});

it.each(["before", "during"])("已有文件收集响应取消：%s", (phase) => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-collect-cancel-"));
  const native = new NativeFs();
  native.write_file_sync(path.join(temp.path, "Data/nested/a.txt"), "a");
  const controller = new AbortController();
  if (phase === "before") controller.abort(new Error("cancel collection"));
  else {
    const read = native.read_dirents.bind(native);
    vi.spyOn(native, "read_dirents").mockImplementation((directory) => {
      const entries = read(directory);
      controller.abort(new Error("cancel collection"));
      return entries;
    });
  }
  const files = new Set<string>();
  expect(() => collect_existing_files(temp.path, "Data", files, native, controller.signal)).toThrow(
    "cancel collection",
  );
  expect(files.size).toBe(0);
});

it("入口、祖先、后代和悬空目录链接都拒绝收集", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-collect-link-"));
  fs.mkdirSync(path.join(temp.path, "Data"));
  fs.mkdirSync(path.join(temp.path, "outside"));
  fs.symlinkSync(path.join(temp.path, "outside"), path.join(temp.path, "Data/link"), "junction");
  const native = new NativeFs();
  for (const name of ["Data", "Data/link", "Data/link/missing"]) {
    expect(() => collect_existing_files(temp.path, name, new Set(), native)).toThrow("Unsafe");
  }
  fs.rmdirSync(path.join(temp.path, "outside"));
  expect(() => collect_existing_files(temp.path, "Data/link", new Set(), native)).toThrow("Unsafe");
});

it("枚举后替换的目录链接及访问失败继续向调用者报错", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-collect-race-"));
  fs.mkdirSync(path.join(temp.path, "Data/nested"), { recursive: true });
  fs.mkdirSync(path.join(temp.path, "outside"));
  const native = new NativeFs();
  const read = native.read_dirents.bind(native);
  const enumeration = vi.spyOn(native, "read_dirents").mockImplementationOnce((directory) => {
    const entries = read(directory);
    fs.rmdirSync(path.join(temp.path, "Data/nested"));
    fs.symlinkSync(
      path.join(temp.path, "outside"),
      path.join(temp.path, "Data/nested"),
      "junction",
    );
    return entries;
  });
  expect(() => collect_existing_files(temp.path, "Data", new Set(), native)).toThrow("Unsafe");
  enumeration.mockImplementation(() => {
    throw new Error("access denied");
  });
  expect(() => collect_existing_files(temp.path, "Data", new Set(), native)).toThrow(
    "access denied",
  );
  vi.spyOn(native, "lstat").mockImplementation(() => {
    throw new Error("stat denied");
  });
  expect(() => collect_existing_files(temp.path, "Data", new Set(), native)).toThrow("stat denied");
});

it.each([
  "backup_lg/a.json",
  ".tmp/a.json",
  "backup_lg_20261015_093000/a",
  "BACKUP_LG_20261015_093000_1/a",
])("游戏成员不得占用管理路径：%s", (name) =>
  expect(() => validate_game_path(name)).toThrow("Member conflicts with preparation files"),
);

it.each([".lg-original/a", "backup_lg_20261015_093000_0/a", "backup_lg_invalid/a"])(
  "旧名称及不符合归档格式的名称可用：%s",
  (name) => {
    expect(() => validate_game_path(name)).not.toThrow();
  },
);

it("游戏成员的父目录拼写必须一致", () => {
  expect(() => assert_game_path_spellings(["New/a.txt", "new/b.txt"])).toThrow();
  expect(() => assert_game_path_spellings(["New/a.txt", "New/b.txt"])).not.toThrow();
});

it.each([
  ["我的游戏.zip", "RPGMAKER_MV_MZ", "我的游戏"],
  ["game.zip.zip", "RPGMAKER_MV_MZ", "game.zip"],
  ["folder\\game.zip.zip", "RPGMAKER_MV_MZ", "folder/game.zip"],
  ["game.zip", "TXT", "game.zip"],
  ["game.zip", "RPGMAKER_RGSS", "game"],
])("译文输出路径只由资产身份和类型决定：%s", (file, type, expected) => {
  expect(source_file_output_path(file, type)).toBe(expected);
});

it.each(["game", ".zip", "folder/.zip", "../game.zip", "game:stream.zip", "game..zip", "CON.zip"])(
  "拒绝非法 RM 身份：%s",
  (file) => {
    expect(() => source_file_output_path(file, "RPGMAKER_MV_MZ")).toThrow();
  },
);

it.each(["game/readme.txt", "GAME", "game.zip/child.txt"])(
  "资产路径和译文输出路径都拒绝冲突：%s",
  (path) => {
    for (const reverse of [false, true]) {
      const files = [
        { path: "game.zip", file_type: "RPGMAKER_RGSS" },
        { path, file_type: "TXT" },
      ];
      expect(() => assert_source_file_paths(reverse ? files.reverse() : files)).toThrow();
    }
  },
);

it("同名替换只允许同一资产，拒绝借用游戏的输出目录", () => {
  const index = new SourceFilePathIndex();
  index.add("game.zip", "RPGMAKER_MV_MZ");
  expect(index.find_conflict("GAME.zip", "RPGMAKER_MV_MZ", true)).toBeNull();
  expect(index.find_conflict("game", "TXT", true)).toBe("game");
});
