import { expect, it } from "vitest";
import { assert_project_asset_paths } from "./project-asset-paths";

it.each([
  ["game", "game/readme.txt"],
  ["game/readme.txt", "game"],
  ["GAME", "game\\data\\Actors.json"],
  ["game//readme.txt", "GAME\\readme.txt"],
])("拒绝不能共同投影的资产集合 %j", (...paths) => {
  expect(() => assert_project_asset_paths(paths)).toThrow();
});

it("共同目录和相似前缀保持独立身份", () => {
  expect(() =>
    assert_project_asset_paths(["game/a.txt", "game/b.txt", "game2", " game"]),
  ).not.toThrow();
});
