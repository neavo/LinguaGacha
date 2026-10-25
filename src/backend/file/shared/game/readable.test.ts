import { expect, it } from "vitest";
import { write_projection } from "./readable";

it("成员解析失败时只写出错误投影", async () => {
  const outputs = [];
  for await (const [name, bytes] of write_projection("data/a.bin", () => {
    throw new Error("broken");
  }))
    outputs.push([name, JSON.parse(Buffer.from(bytes).toString())]);
  expect(outputs).toEqual([
    ["data/a.bin.error.reference.json", { internal_file_path: "data/a.bin", error: "broken" }],
  ]);
});
