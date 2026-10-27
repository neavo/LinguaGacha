import { expect, it } from "vitest";
import { extract_parent_dir } from "./path";

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
