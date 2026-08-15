import { describe, expect, it } from "vitest";

import { is_json_record, read_json_boolean, read_json_integer, read_json_record } from "./json";

describe("JSON 领域值", () => {
  it("仅接受非空且非数组的对象载荷", () => {
    const record = { ok: true };

    expect(is_json_record(record)).toBe(true);
    expect(read_json_record(record)).toEqual(record);
    expect(is_json_record(null)).toBe(false);
    expect(read_json_record(null)).toEqual({});
    expect(is_json_record(["not-record"])).toBe(false);
    expect(read_json_record(["not-record"])).toEqual({});
  });

  it.each([
    [4.8, 2, 4],
    ["7", 2, 7],
    [null, 2, 2],
    [Number.POSITIVE_INFINITY, 2, 2],
    ["invalid", 2, 2],
  ])("将边界值 %j 收窄为有限整数 %i", (value, fallback, expected) => {
    expect(read_json_integer(value, fallback)).toBe(expected);
  });

  it.each([
    [true, false, true],
    [0, true, false],
    [" 1 ", false, true],
    ["false", true, false],
    ["invalid", true, true],
  ])("将持久化边界值 %j 收窄为布尔值 %j", (value, fallback, expected) => {
    expect(read_json_boolean(value, fallback)).toBe(expected);
  });
});
