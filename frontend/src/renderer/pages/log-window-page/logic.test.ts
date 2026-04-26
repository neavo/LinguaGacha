import { describe, expect, it } from "vitest";

import type { LogEvent } from "@/app/desktop-api";
import {
  append_log_event,
  compress_log_message_text,
  filter_log_events,
  format_log_timestamp,
  get_log_message_first_line,
  sort_log_events_latest_first,
} from "@/pages/log-window-page/logic";

function build_event(overrides: Partial<LogEvent>): LogEvent {
  return {
    id: "log-1",
    sequence: 1,
    created_at: "2026-04-26T08:30:15.000+00:00",
    level: "info",
    message: "hello",
    ...overrides,
  };
}

describe("log-window logic", () => {
  it("提取消息第一行并处理空白消息", () => {
    expect(get_log_message_first_line("第一行\n第二行")).toBe("第一行");
    expect(get_log_message_first_line("\n第二行")).toBe("(blank)");
  });

  it("压缩多行日志消息以用于表格预览", () => {
    expect(compress_log_message_text("第一行\n第二行\r\n第三行")).toBe("第一行 ↵ 第二行 ↵ 第三行");
    expect(compress_log_message_text("\n")).toBe("(blank)");
  });

  it("追加日志时会 trim 消息并折叠连续空日志", () => {
    const first_empty = build_event({ id: "log-1", sequence: 1, message: "  " });
    const latest_empty = build_event({ id: "log-2", sequence: 2, message: "\n\t" });
    const next_message = build_event({ id: "log-3", sequence: 3, message: "  ready  " });

    const with_first_empty = append_log_event([], first_empty);
    const with_latest_empty = append_log_event(with_first_empty, latest_empty);
    const with_next_message = append_log_event(with_latest_empty, next_message);

    expect(with_first_empty).toHaveLength(1);
    expect(with_first_empty[0]?.message).toBe("");
    expect(with_latest_empty.map((event) => event.id)).toEqual(["log-2"]);
    expect(with_next_message.map((event) => event.message)).toEqual(["", "ready"]);
  });

  it("按序号倒序展示日志", () => {
    const events = [
      build_event({ id: "log-1", sequence: 1 }),
      build_event({ id: "log-3", sequence: 3 }),
      build_event({ id: "log-2", sequence: 2 }),
    ];

    expect(sort_log_events_latest_first(events).map((event) => event.id)).toEqual([
      "log-3",
      "log-2",
      "log-1",
    ]);
  });

  it("按级别和关键词过滤日志", () => {
    const events = [
      build_event({ id: "log-1", level: "info", message: "ready" }),
      build_event({ id: "log-2", level: "error", message: "task boom" }),
    ];

    expect(
      filter_log_events({
        events,
        level_filter: "error",
        keyword: "task",
      }).map((event) => event.id),
    ).toEqual(["log-2"]);
  });

  it("支持使用正则表达式过滤日志", () => {
    const events = [
      build_event({ id: "log-1", message: "ready 12" }),
      build_event({ id: "log-2", message: "ready 99" }),
    ];

    expect(
      filter_log_events({
        events,
        level_filter: "all",
        keyword: "ready\\s+9\\d",
        is_regex: true,
      }).map((event) => event.id),
    ).toEqual(["log-2"]);
  });

  it("格式化完整日志时间戳", () => {
    expect(format_log_timestamp("2026-04-26T08:30:15.000+00:00")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it("无法解析的时间戳原样返回", () => {
    expect(format_log_timestamp("bad-date")).toBe("bad-date");
  });
});
