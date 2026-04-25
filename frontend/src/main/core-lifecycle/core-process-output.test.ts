import { describe, expect, it } from "vitest";

import {
  format_core_process_output_line,
  sanitize_core_process_output,
} from "./core-process-output";

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
