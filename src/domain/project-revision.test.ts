import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import { PROJECT_REVISION_SCHEMA, read_project_revision } from "./project-revision";

describe("项目修订读取", () => {
  it.each([
    { value: 8, expected: 8 },
    { value: "8", expected: 8 },
    { value: 1.8, expected: 1 },
    { value: "1.8", expected: 1 },
    { value: -1, expected: 0 },
    { value: "-1.8", expected: 0 },
    { value: undefined, expected: 0 },
    { value: null, expected: 0 },
    { value: "bad", expected: 0 },
    { value: "Infinity", expected: 0 },
    { value: NaN, expected: 0 },
    { value: Infinity, expected: 0 },
    { value: -Infinity, expected: 0 },
    { value: 0, expected: 0 },
  ])("历史值 $value 读取为 $expected", ({ value, expected }) => {
    const revision = read_project_revision(value);
    expect(revision).toBe(expected);
    expect(Check(PROJECT_REVISION_SCHEMA, revision)).toBe(true);
  });
});
