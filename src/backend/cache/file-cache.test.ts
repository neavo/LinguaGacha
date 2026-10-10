import { describe, expect, it } from "vitest";

import { FileCache } from "./file-cache";

describe("FileCache", () => {
  it("保存规范文件记录、按顺序排列并隔离读取引用", () => {
    const cache = new FileCache();

    cache.replace({
      first: { rel_path: "b.txt", file_type: "TXT", sort_index: 2 },
      second: { rel_path: "a.txt", file_type: "NONE", sort_index: 3 },
    });

    const entries = cache.readFileEntries();
    entries[0]!.rel_path = "changed";
    entries.push({ rel_path: "new", file_type: "TXT", sort_index: 4 });
    expect(cache.readFileEntries()).toEqual([
      { rel_path: "b.txt", file_type: "TXT", sort_index: 2 },
      { rel_path: "a.txt", file_type: "NONE", sort_index: 3 },
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
