import { describe, expect, it } from "vitest";

import { format_console_log } from "./log-console-formatter";
import type { LogAppendPayload } from "../../shared/log";

describe("format_console_log", () => {
  const created_at = new Date(2012, 11, 12, 12, 12, 12);
  const info_prefix =
    "\x1b[2m\x1b[36m[12:12:12]\x1b[39m\x1b[22m  \x1b[36mINFO   \x1b[39m  ";

  it("按 Rich 风格时间戳和 LEVEL MESSAGE 对齐", () => {
    expect(format_console_log(create_payload("控制台消息"), created_at)).toBe(
      `${info_prefix}控制台消息\n`,
    );
  });

  it("消息体使用 Rich 风格轻量语法高亮", () => {
    expect(format_console_log(create_payload("def run(value: 42) -> True"), created_at)).toBe(
      `${info_prefix}\x1b[36mdef\x1b[39m run(value\x1b[35m:\x1b[39m \x1b[94m42\x1b[39m) \x1b[35m->\x1b[39m \x1b[32m\x1b[3mTrue\x1b[23m\x1b[39m\n`,
    );
  });

  it("优先把 URL 作为整体高亮", () => {
    expect(
      format_console_log(create_payload("API Gateway 已启动 - http://127.0.0.1:65425"), created_at),
    ).toBe(
      `${info_prefix}API Gateway 已启动 - \x1b[94mhttp://127.0.0.1:65425\x1b[39m\n`,
    );
  });

  it("版本号从 v 开始整段高亮", () => {
    expect(format_console_log(create_payload("LinguaGacha v0.99.4 …"), created_at)).toBe(
      `${info_prefix}LinguaGacha \x1b[94mv0.99.4\x1b[39m …\n`,
    );
  });

  it("多行消息从第二行开始对齐首行正文缩进", () => {
    expect(format_console_log(create_payload("任务提示词：\nno_key_required"), created_at)).toBe(
      `${info_prefix}任务提示词：\n                     no_key_required\n`,
    );
  });

  it("按终端列宽预折行并让软换行对齐正文缩进", () => {
    expect(format_console_log(create_payload("abcdefghijkl"), created_at, { columns: 31 })).toBe(
      `${info_prefix}abcdefghij\n                     kl\n`,
    );
  });

  it("预折行时按终端列宽计算 ANSI 高亮和宽字符", () => {
    expect(format_console_log(create_payload("测试v0.99.4完成"), created_at, { columns: 32 })).toBe(
      `${info_prefix}测试\x1b[94mv0.99.4\x1b[39m\n                     完成\n`,
    );
  });

  it("消息体已有 ANSI 时不重复高亮", () => {
    expect(format_console_log(create_payload("\x1b[31m已有颜色\x1b[0m"), created_at)).toBe(
      `${info_prefix}\x1b[31m已有颜色\x1b[0m\n`,
    );
  });

  function create_payload(message: string): LogAppendPayload {
    return {
      level: "info",
      message,
    };
  }
});
