import { describe, expect, expectTypeOf, it } from "vitest";

import {
  is_json_record,
  read_json_record,
  type JsonRecord,
  type JsonValue,
  type MutableJsonRecord,
} from "./json";

describe("JSON 领域值", () => {
  it("只把非空普通对象收窄为 JSON record", () => {
    const record = { ok: true };

    expect(is_json_record(record)).toBe(true);
    expect(read_json_record(record)).toBe(record);
    expect(is_json_record(null)).toBe(false);
    expect(is_json_record(["not-record"])).toBe(false);
    expect(read_json_record(["not-record"])).toEqual({});
  });

  it("记录类型统一属于公共 JSON 值契约", () => {
    expectTypeOf<JsonRecord>().toMatchTypeOf<JsonValue>();
    expectTypeOf<MutableJsonRecord>().toEqualTypeOf<JsonRecord>();
  });
});
