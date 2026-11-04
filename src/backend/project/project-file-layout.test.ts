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
it.each([
  ["notes.txt", "TXT", "renamed.txt"],
  ["game.zip", "GODOT", "other.zip"],
  ["game.godot", "GODOT", "folder/other.godot"],
])("改名保留扩展名 %#", (file, file_type, target) => {
  expect(
    resolve_project_file_layout(
      [{ path: file, file_type }],
      [],
      [{ file_path: file, new_file_path: target, line: 1 }],
    )[0]?.path,
  ).toBe(target);
});
it.each([
  ["notes.txt", "notes.md"],
  ["notes.txt", "notes.TXT"],
  ["game.zip", "game.godot"],
  [".env", "x.env"],
  ["notes.txt", "a:b.txt"],
  ["notes.txt", "CON.txt"],
])("拒绝改变扩展名或跨平台非法的名称：%s → %s", (file, target) => {
  expect(() =>
    resolve_project_file_layout(
      [{ path: file, file_type: "TXT" }],
      [],
      [{ file_path: file, new_file_path: target, line: 1 }],
    ),
  ).toThrow(expect.objectContaining({ code: "request.validation_failed" }));
});

it.each(["other.txt", "folder.txt"])("改名冲突说明占用的路径：%s", (target) => {
  expect(() =>
    resolve_project_file_layout(
      ["old.txt", "other.txt", "folder.txt/child.txt"].map((path) => ({ path, file_type: "TXT" })),
      [],
      [{ file_path: "old.txt", new_file_path: target, line: 1 }],
    ),
  ).toThrow(
    expect.objectContaining({
      code: "request.validation_failed",
      message: expect.stringContaining(target),
    }),
  );
});
