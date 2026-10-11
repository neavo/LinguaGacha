import { expect, it } from "vitest";
import { ProjectAssetPathIndex } from "./project-asset-paths";

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
