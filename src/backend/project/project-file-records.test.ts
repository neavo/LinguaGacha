import { expect, it } from "vitest";
import { build_project_file_records } from "./project-file-records";

it("asset 提供工程顺序，历史条目补在末尾，PDF 身份优先且允许零条目文件", () => {
  expect(
    build_project_file_records(
      [
        { path: "empty.pdf", sort_order: 2 },
        { path: "book.pdf", sort_order: 5 },
        { path: "text.txt", sort_order: 8 },
        { path: "other.bin", sort_order: 9 },
      ],
      [
        { file_path: "book.pdf", file_type: "TXT" },
        { file_path: "text.txt", file_type: "TXT" },
        { file_path: "orphan.txt", file_type: "TXT" },
      ],
      ["book.pdf", "empty.pdf"],
    ),
  ).toEqual({
    "empty.pdf": { rel_path: "empty.pdf", file_type: "PDF", sort_index: 2 },
    "book.pdf": { rel_path: "book.pdf", file_type: "PDF", sort_index: 5 },
    "text.txt": { rel_path: "text.txt", file_type: "TXT", sort_index: 8 },
    "other.bin": { rel_path: "other.bin", file_type: "NONE", sort_index: 9 },
    "orphan.txt": { rel_path: "orphan.txt", file_type: "TXT", sort_index: 10 },
  });
});
