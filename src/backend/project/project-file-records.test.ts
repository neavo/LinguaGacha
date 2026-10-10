import { expect, it } from "vitest";
import { build_project_file_records } from "./project-file-records";

it("asset 提供工程顺序，历史条目补在末尾，PDF 身份优先且允许零条目文件", () => {
  expect(
    build_project_file_records(
      [
        { path: "empty.pdf", sort_order: 2 },
        { path: "book.ssa", sort_order: 5 },
        { path: "text.srt", sort_order: 8 },
        { path: "other.bin", sort_order: 9 },
      ],
      [
        { file_path: "book.ssa", file_type: "TXT" },
        { file_path: "text.srt", file_type: "TXT" },
        { file_path: "orphan.txt", file_type: "TXT" },
      ],
      ["book.ssa", "empty.pdf"],
    ),
  ).toEqual({
    "empty.pdf": { rel_path: "empty.pdf", file_type: "PDF", sort_index: 2 },
    "book.ssa": { rel_path: "book.ssa", file_type: "PDF", sort_index: 5 },
    "text.srt": { rel_path: "text.srt", file_type: "TXT", sort_index: 8 },
    "other.bin": { rel_path: "other.bin", file_type: "NONE", sort_index: 9 },
    "orphan.txt": { rel_path: "orphan.txt", file_type: "TXT", sort_index: 10 },
  });
});

it("生成入口保留准确路径，按原值去重并补齐稳定顺序与类型", () => {
  expect(
    build_project_file_records(
      [
        { path: " a.txt ", sort_order: 2.8 },
        { path: "a.txt", sort_order: 9 },
        { path: " a.txt ", sort_order: 8 },
        { path: "", sort_order: 0 },
        { path: "b.txt", sort_order: Number.NaN },
      ],
      [
        { file_path: " orphan.srt", file_type: "NONE" },
        { file_path: "", file_type: "TXT" },
      ],
      [],
    ),
  ).toEqual({
    " a.txt ": { rel_path: " a.txt ", file_type: "NONE", sort_index: 2 },
    "a.txt": { rel_path: "a.txt", file_type: "NONE", sort_index: 9 },
    "b.txt": { rel_path: "b.txt", file_type: "NONE", sort_index: 4 },
    " orphan.srt": { rel_path: " orphan.srt", file_type: "SRT", sort_index: 10 },
  });
});
