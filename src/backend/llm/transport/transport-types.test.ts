import { describe, expect, it } from "vitest";

import {
  empty_llm_result,
  read_transport_number,
  read_transport_record,
  read_transport_text,
} from "./transport-types";

describe("transport-types", () => {
  it("构造完整空响应并允许调用方覆盖已知字段", () => {
    expect(empty_llm_result({ response_result: "译文", input_tokens: 3 })).toEqual({
      response_think: "",
      response_result: "译文",
      input_tokens: 3,
      output_tokens: 0,
      cancelled: false,
      timeout: false,
      degraded: false,
    });
  });

  it("只接受普通对象和字符串进入传输字段解析", () => {
    const record = { value: "ok" };

    expect(read_transport_record(record)).toBe(record);
    expect(read_transport_record([])).toEqual({});
    expect(read_transport_text("正文")).toBe("正文");
    expect(read_transport_text(1)).toBe("");
  });

  it("数值字段截断有限值，非法值保留已有累计量", () => {
    expect(read_transport_number("4.8", 2)).toBe(4);
    expect(read_transport_number("invalid", 2)).toBe(2);
  });
});
