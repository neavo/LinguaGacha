import { expect, it } from "vitest";
import { read_source_operation_result } from "./source-operation";

it("动态操作回执拒绝无效事实，并隔离调用方的目录数组", () => {
  const input = { saved_assets: 1, directory_changes: ["game"] };
  const result = read_source_operation_result(input);
  expect(result).toEqual(input);
  input.directory_changes.push("later");
  expect(result?.directory_changes).toEqual(["game"]);
  for (const value of [
    null,
    { ...input, saved_assets: -1 },
    { ...input, saved_assets: 0.5 },
    { ...input, saved_assets: "1" },
    { ...input, directory_changes: [null] },
  ])
    expect(read_source_operation_result(value)).toBeUndefined();
});
