import { expect, it } from "vitest";
import {
  assert_source_file_paths,
  source_file_output_path,
  SourceFilePathIndex,
  validate_game_path,
  assert_game_path_spellings,
} from "./source-file-paths";

it.each([
  "backup_lg/a.json",
  ".tmp/a.json",
  ".linguagacha-backup.json",
  ".lg-original/a",
  ".lg-original-temp/a",
  "backup/a",
])("游戏成员不得占用管理路径：%s", (name) =>
  expect(() => validate_game_path(name)).toThrow("Member conflicts with preparation files"),
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
