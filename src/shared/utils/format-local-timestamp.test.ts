import { describe, expect, it } from "vitest";
import { format_local_timestamp } from "./format-local-timestamp";

describe("format_local_timestamp", () => {
  it("将带时区时间显示为本地时间并去掉毫秒", () => {
    const local = new Date(2020, 11, 12, 12, 12, 12, 456);
    expect(format_local_timestamp(local.toISOString())).toBe("2020-12-12 12:12:12");
  });
  it("按本地时间解释历史值并把无效值交给消费者处理", () => {
    expect(format_local_timestamp("2020-12-12T12:12:12.346420")).toBe("2020-12-12 12:12:12");
    expect(format_local_timestamp("invalid")).toBeNull();
  });
});
