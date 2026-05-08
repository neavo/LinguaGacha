import { describe, expect, it } from "vitest";

import { format_console_log } from "./log-console-formatter";
import type { LogAppendPayload } from "./log-types";

describe("format_console_log", () => {
  const created_at = new Date(2012, 11, 12, 12, 12, 12);

  it("按 Rich 风格时间戳和 LEVEL MESSAGE 对齐", () => {
    expect(format_console_log(create_payload("控制台消息"), created_at)).toBe(
      "\x1b[2;36m[12:12:12]\x1b[0m  \x1b[36mINFO   \x1b[0m  控制台消息\n",
    );
  });

  it("消息体使用 Rich 风格轻量语法高亮", () => {
    expect(format_console_log(create_payload("def run(value: 42) -> True"), created_at)).toBe(
      "\x1b[2;36m[12:12:12]\x1b[0m  \x1b[36mINFO   \x1b[0m  \x1b[36mdef\x1b[0m run(value\x1b[35m:\x1b[0m \x1b[94m42\x1b[0m) \x1b[35m->\x1b[0m \x1b[32;3mTrue\x1b[0m\n",
    );
  });

  it("优先把 URL 作为整体高亮", () => {
    expect(
      format_console_log(create_payload("TS Gateway 已启动 - http://127.0.0.1:65425"), created_at),
    ).toBe(
      "\x1b[2;36m[12:12:12]\x1b[0m  \x1b[36mINFO   \x1b[0m  TS Gateway 已启动 - \x1b[94mhttp://127.0.0.1:65425\x1b[0m\n",
    );
  });

  it("消息体已有 ANSI 时不重复高亮", () => {
    expect(format_console_log(create_payload("\x1b[31m已有颜色\x1b[0m"), created_at)).toBe(
      "\x1b[2;36m[12:12:12]\x1b[0m  \x1b[36mINFO   \x1b[0m  \x1b[31m已有颜色\x1b[0m\n",
    );
  });

  function create_payload(message: string): LogAppendPayload {
    return {
      level: "info",
      message,
    };
  }
});
