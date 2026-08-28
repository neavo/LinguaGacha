import { describe, expect, it } from "vitest";

import { replace_project_file_items } from "./project-open-file-item-replacement";

describe("replace_project_file_items", () => {
  it("在目标文件首次出现处替换全部旧项并保留其它当前事实", () => {
    const current_items = [
      { id: 1, file_path: "a.md", src: "旧一" },
      { id: 2, file_path: "other.txt", src: "保留" },
      { id: 3, file_path: "a.md", src: "旧二" },
      { id: 4, file_path: "book.epub", src: "事务内新事实" },
    ];

    expect(
      replace_project_file_items(
        current_items,
        new Map([["a.md", [{ id: 1, file_path: "a.md", src: "新块" }]]]),
      ),
    ).toEqual([
      { id: 1, file_path: "a.md", src: "新块" },
      { id: 2, file_path: "other.txt", src: "保留" },
      { id: 4, file_path: "book.epub", src: "事务内新事实" },
    ]);
  });

  it("替换多个文件时各自在原位置出现一次", () => {
    expect(
      replace_project_file_items(
        [
          { file_path: "a.md", src: "a1" },
          { file_path: "b.md", src: "b1" },
          { file_path: "a.md", src: "a2" },
        ],
        new Map([
          ["a.md", [{ file_path: "a.md", src: "A" }]],
          ["b.md", [{ file_path: "b.md", src: "B" }]],
        ]),
      ),
    ).toEqual([
      { file_path: "a.md", src: "A" },
      { file_path: "b.md", src: "B" },
    ]);
  });
});
