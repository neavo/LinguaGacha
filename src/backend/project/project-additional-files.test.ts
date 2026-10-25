import { expect, it } from "vitest";
import { read_project_additional_files } from "./project-additional-files";

it("旧工程没有清单时读取为空", () => {
  expect(read_project_additional_files({})).toEqual({});
});

it("损坏清单禁止静默回退到全部解析", () => {
  expect(() => read_project_additional_files({ additional_files: [] })).toThrow();
  expect(() =>
    read_project_additional_files({ additional_files: { "game.godot": [1] } }),
  ).toThrow();
});
