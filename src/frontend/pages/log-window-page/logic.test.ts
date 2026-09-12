import { describe, expect, it } from "vitest";

import type { LogEntry } from "@frontend/app/desktop/desktop-api";
import {
  filter_log_entries,
  sort_log_entries_latest_first,
} from "@frontend/pages/log-window-page/logic";

/** 提供完整摘要夹具，场景只覆写需要变化的字段。 */
function build_event(overrides: Partial<LogEntry>): LogEntry {
  return {
    id: "log-1",
    date: "20260426",
    revision: "rev",
    line: 1,
    created_at: "2026-04-26T08:30:15.000+00:00",
    level: "info",
    source: "test",
    message_preview: "hello",
    message_length: 5,
    ...overrides,
  };
}

describe("log-window logic", () => {
  it("按日期与物理行号倒序展示日志", () => {
    const events = [
      build_event({ id: "log-1", line: 1 }),
      build_event({ id: "log-3", line: 3 }),
      build_event({ id: "log-2", line: 2 }),
    ];

    expect(sort_log_entries_latest_first(events).map((event) => event.id)).toEqual([
      "log-3",
      "log-2",
      "log-1",
    ]);
  });

  it("按级别和关键词过滤日志", () => {
    const events = [
      build_event({ id: "log-1", level: "info", message_preview: "ready" }),
      build_event({ id: "log-2", level: "error", message_preview: "task boom" }),
    ];

    expect(
      filter_log_entries({
        events,
        level_filter: "error",
        keyword: "task",
      }).map((event) => event.id),
    ).toEqual(["log-2"]);
  });

  it("支持使用正则表达式过滤日志", () => {
    const events = [
      build_event({ id: "log-1", message_preview: "ready 12" }),
      build_event({ id: "log-2", message_preview: "ready 99" }),
    ];

    expect(
      filter_log_entries({
        events,
        level_filter: "all",
        keyword: "ready\\s+9\\d",
        is_regex: true,
      }).map((event) => event.id),
    ).toEqual(["log-2"]);
  });
});
