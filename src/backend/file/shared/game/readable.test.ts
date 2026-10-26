import { expect, it, vi } from "vitest";
import { write_projection } from "./readable";
it("成员失败只报告诊断，不生成错误文件", async () => {
  const outputs = [],
    report = vi.fn(),
    error = new Error("broken");
  for await (const output of write_projection(
    "data/a.bin",
    () => {
      throw error;
    },
    report,
  ))
    outputs.push(output);
  expect(outputs).toEqual([]);
  expect(report).toHaveBeenCalledWith("data/a.bin", error);
});
