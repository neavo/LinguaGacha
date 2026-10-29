import { expect, it } from "vitest";
import { extract_file_name, extract_parent_dir } from "./path";

it("提取路径末段时忽略目录末尾的分隔符", () => {
  expect(extract_file_name("E:\\games\\demo.lg")).toBe("demo.lg");
  expect(extract_file_name("/games/demo/")).toBe("demo");
});

it("提取父目录时保留盘符根、POSIX 根和网络共享路径", () => {
  for (const [file, parent] of [
    ["E:/demo.lg", "E:/"],
    ["E:\\demo.lg", "E:\\"],
    ["/demo.lg", "/"],
    ["/projects/demo.lg", "/projects"],
    ["\\\\server\\share\\demo.lg", "\\\\server\\share"],
    ["demo.lg", ""],
  ] as const) {
    expect(extract_parent_dir(file), file).toBe(parent);
  }
});
