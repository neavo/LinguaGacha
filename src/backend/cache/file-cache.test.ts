import { describe, expect, it } from "vitest";

import { FileCache } from "./file-cache";

describe("FileCache", () => {
  it("从 files block 提取稳定文件条目并过滤无效路径", () => {
    const cache = new FileCache();

    cache.replace({
      first: { rel_path: "b.txt", file_type: "TXT", sort_index: 2 },
      invalid: { rel_path: "", file_type: "TXT", sort_index: 0 },
      second: { rel_path: "a.txt", file_type: "NONE" },
    });

    expect(cache.readFileEntries()).toEqual([
      { rel_path: "b.txt", file_type: "TXT", sort_index: 2 },
      { rel_path: "a.txt", file_type: "NONE", sort_index: 2 },
    ]);
  });
  it("按保存顺序排列文件，数字路径不受对象键枚举顺序影响", () => {
    const cache = new FileCache();
    cache.replace({
      "1": { rel_path: "1", file_type: "TXT", sort_index: 1 },
      "2": { rel_path: "2", file_type: "TXT", sort_index: 0 },
    });
    expect(cache.readFileEntries().map((file) => file.rel_path)).toEqual(["2", "1"]);
  });
});
