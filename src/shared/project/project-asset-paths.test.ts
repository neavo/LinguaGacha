import { expect, it } from "vitest";
import {
  assert_source_file_paths,
  ProjectAssetPathIndex,
  source_file_output_path,
  SourceFilePathIndex,
} from "./project-asset-paths";

it.each([
  ["game", "game/readme.txt"],
  ["game/readme.txt", "game"],
  ["GAME", "game\\data\\Actors.json"],
  ["game//readme.txt", "GAME\\readme.txt"],
])("拒绝不能共同投影的资产集合 %j", (...paths) => {
  const index = new ProjectAssetPathIndex();
  expect(() => paths.forEach((path) => index.add(path))).toThrow();
});

it("共同目录和相似前缀保持独立身份", () => {
  const index = new ProjectAssetPathIndex();
  expect(() =>
    ["game/a.txt", "game/b.txt", "game2", " game"].forEach((path) => index.add(path)),
  ).not.toThrow();
});

it.each([
  ["我的游戏.zip", "RPGMAKER_MV_MZ", "我的游戏"],
  ["我的游戏.godot", "GODOT", "我的游戏"],
  ["game.rpgmaker", "RPGMAKER_MV_MZ", "game"],
  ["game.rpgmaker", "RPGMAKER_RGSS", "game"],
  ["game.wolfrpg", "WOLFRPG", "game"],
  ["game.zip.godot", "GODOT", "game.zip"],
  ["folder\\game.zip.zip", "RPGMAKER_MV_MZ", "folder/game.zip"],
  ["game.zip", "TXT", "game.zip"],
])("译文输出路径只由资产身份和类型决定：%s", (file, type, expected) => {
  expect(source_file_output_path(file, type)).toBe(expected);
});

it.each(["game", ".zip", "folder/.zip", "../game.zip", "game:stream.zip", "game..zip", "CON.zip"])(
  "拒绝非法 RM 身份：%s",
  (file) => {
    expect(() => source_file_output_path(file, "RPGMAKER_MV_MZ")).toThrow();
  },
);

it.each([
  ["game.rpgmaker", "GODOT"],
  ["game.godot", "RPGMAKER_MV_MZ"],
  ["game.wolfrpg", "RPGMAKER_RGSS"],
  ["game.godot", "WOLFRPG"],
  [".godot", "GODOT"],
  ["folder/.rpgmaker", "RPGMAKER_RGSS"],
])("拒绝不匹配的游戏后缀和空名称：%s (%s)", (file, type) => {
  expect(() => source_file_output_path(file, type)).toThrow(
    expect.objectContaining({ code: "request.validation_failed" }),
  );
});

it("新旧后缀的不同资产不能共享输出目录，也不能借同名替换豁免冲突", () => {
  const index = new SourceFilePathIndex();
  index.add("game.zip", "GODOT");
  expect(index.find_conflict("game.godot", "GODOT", true)).toBe("game");
  expect(() => index.add("game.godot", "GODOT")).toThrow();
});

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
