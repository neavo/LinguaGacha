import { expect, it } from "vitest";
import { build_project_file_paths } from "./project-file-paths";

it("保留 asset 顺序，按首次出现补齐历史路径并忽略空路径", () => {
  expect(build_project_file_paths(["b", "a"], ["a", "", "c", "b", "d", "c"])).toEqual([
    "b",
    "a",
    "c",
    "d",
  ]);
});
