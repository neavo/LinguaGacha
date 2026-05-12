import { describe, expect, it } from "vitest";

import { is_task_visible_log_level, normalize_log_level } from "./log";

describe("log 基础模型", () => {
  it("规范化日志等级并识别任务可见等级", () => {
    expect(normalize_log_level("warning")).toBe("warning");
    expect(normalize_log_level("bad")).toBe("info");
    expect(is_task_visible_log_level("warning")).toBe(true);
    expect(is_task_visible_log_level("debug")).toBe(false);
  });
});
