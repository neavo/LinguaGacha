import { describe, expect, it } from "vitest";

import {
  format_core_process_output_line,
  normalize_core_process_log_message,
  normalize_core_process_log_record,
  sanitize_core_process_output,
} from "./lifecycle-process-output";

describe("sanitize_core_process_output", () => {
  it("保留 Rich 颜色 SGR 控制序列", () => {
    const raw_text = "\u001B[38;5;6m[00:48:19]\u001B[0m INFO \u001B[32mLinguaGacha\u001B[0m";

    expect(sanitize_core_process_output(raw_text)).toBe(raw_text);
  });

  it("移除 OSC 控制序列并把回车归一为换行", () => {
    const raw_text = "\u001B]0;title\u0007ready\rnext";

    expect(sanitize_core_process_output(raw_text)).toBe("ready\nnext");
  });

  it("移除清屏和光标移动 CSI 控制序列", () => {
    const raw_text = "\u001B[2Jready\u001B[12;1Hnext";

    expect(sanitize_core_process_output(raw_text)).toBe("readynext");
  });
});

describe("format_core_process_output_line", () => {
  it("透传 Core 行内容，不添加 TS 前缀", () => {
    const reset = `${String.fromCharCode(0x1b)}[0m`;

    expect(format_core_process_output_line("[01:21:35] INFO     LinguaGacha v0.60.1")).toBe(
      `[01:21:35] INFO     LinguaGacha v0.60.1${reset}\n`,
    );
  });

  it("忽略空行", () => {
    expect(format_core_process_output_line("   ")).toBeNull();
  });
});

describe("normalize_core_process_log_message", () => {
  it("移除终端颜色并保留纯文本消息", () => {
    const raw_text = "\u001B[31m[01:21:35] ERROR 失败\u001B[0m\n";

    expect(normalize_core_process_log_message(raw_text)).toBe("[01:21:35] ERROR 失败");
  });
});

describe("normalize_core_process_log_record", () => {
  it("识别 Python fallback 前缀中的真实等级", () => {
    expect(normalize_core_process_log_record("[INFO] [python-core] 收尾完成", "error")).toEqual({
      level: "info",
      message: "收尾完成",
      source: "python-core",
    });
  });

  it("保留 Python fallback 空消息并识别真实等级", () => {
    expect(normalize_core_process_log_record("[INFO] [python-core] \u001B[0m\n", "error")).toEqual({
      level: "info",
      message: "",
      source: "python-core",
    });
  });

  it("普通 stderr 行仍按错误等级记录", () => {
    expect(normalize_core_process_log_record("Traceback line", "error")).toEqual({
      level: "error",
      message: "Traceback line",
      source: "python-stderr",
    });
  });
});
