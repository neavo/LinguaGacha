import { expect, it } from "vitest";
import { build_project_file_records } from "./project-file-records";
it("资产决定文件集合、身份和顺序，零条目文件保留类型", () => {
  expect(
    build_project_file_records([
      { path: "data/Actors.json", file_type: "RPGMAKER_MV_MZ", sort_order: 2 },
      { path: " a.txt ", file_type: "TXT", sort_order: 0 },
      { path: "empty.pdf", file_type: "PDF", sort_order: 1 },
    ]),
  ).toEqual({
    " a.txt ": { rel_path: " a.txt ", file_type: "TXT", sort_index: 0 },
    "empty.pdf": { rel_path: "empty.pdf", file_type: "PDF", sort_index: 1 },
    "data/Actors.json": {
      rel_path: "data/Actors.json",
      file_type: "RPGMAKER_MV_MZ",
      sort_index: 2,
    },
  });
});
