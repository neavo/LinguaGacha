import { expect, it } from "vitest";
import { resolve_project_file_layout } from "./project-file-layout";
const current = ["a", "b", "c", "b_2"].map((path) => ({ path, file_type: "TXT" }));
it("删除释放名称，改名与稳定插入共同决定最终顺序", () => {
  expect(
    resolve_project_file_layout(
      current,
      ["b"],
      [{ file_path: "b_2", new_file_path: "b", sort: 1, line: 1 }],
    ).map((file) => [file.path, file.previous_path]),
  ).toEqual([
    ["a", "a"],
    ["b", "b_2"],
    ["c", "c"],
  ]);
});
it.each([
  [
    { file_path: "a", new_file_path: "b", line: 1 },
    { file_path: "b", new_file_path: "a", line: 2 },
  ],
  [
    { file_path: "a", new_file_path: "b", line: 1 },
    { file_path: "b", new_file_path: "d", line: 2 },
  ],
  [{ file_path: "a", new_file_path: "B", line: 1 }],
  [{ file_path: "a", new_file_path: "b/note.txt", line: 1 }],
  [{ file_path: "a", godot_pack_orders: [], line: 1 }],
  [{ file_path: "a", source_path: "work/a.txt", new_file_path: "new.txt", line: 1 }],
])("拒绝交换、链式及路径占用冲突 %#", (...updates) => {
  expect(() => resolve_project_file_layout(current, [], updates)).toThrow();
});
it("游戏改名须匹配引擎后缀，历史 ZIP 仍可保留原名排序", () => {
  const files = [{ path: "game.zip", file_type: "GODOT" }];
  expect(() =>
    resolve_project_file_layout(
      files,
      [],
      [{ file_path: "game.zip", new_file_path: "other.zip", line: 1 }],
    ),
  ).toThrow();
  expect(
    resolve_project_file_layout(files, [], [{ file_path: "game.zip", sort: -1, line: 1 }])[0]?.path,
  ).toBe("game.zip");
});
