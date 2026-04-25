import { describe, expect, it } from "vitest";

import {
  build_core_process_env,
  parse_windows_console_columns,
  resolve_core_console_width,
} from "./core-lifecycle-manager";

describe("resolve_core_console_width", () => {
  it("优先使用当前终端列宽", () => {
    expect(resolve_core_console_width(188, {}, null)).toBe("188");
  });

  it("允许用户用环境变量覆盖宽度", () => {
    expect(resolve_core_console_width(188, { LINGUAGACHA_CORE_CONSOLE_WIDTH: "220" }, null)).toBe(
      "220",
    );
  });

  it("stdout 列宽不可用时读取 COLUMNS", () => {
    expect(resolve_core_console_width(undefined, { COLUMNS: "144" }, null)).toBe("144");
  });

  it("stdout 和环境列宽都不可用时使用 Windows 控制台查询结果", () => {
    expect(resolve_core_console_width(undefined, {}, "196")).toBe("196");
  });

  it("列宽全都不可用时使用宽松默认值", () => {
    expect(resolve_core_console_width(undefined, {}, null)).toBe("160");
  });
});

describe("parse_windows_console_columns", () => {
  it("解析 mode con 输出里的 Columns", () => {
    expect(parse_windows_console_columns("Status for device CON:\n    Columns:        188\n")).toBe(
      "188",
    );
  });
});

describe("build_core_process_env", () => {
  it("向 Python Core 注入 Rich 控制台宽度", () => {
    const env = build_core_process_env("http://127.0.0.1:3107", "token", "188");

    expect(env["LINGUAGACHA_CORE_CONSOLE_WIDTH"]).toBe("188");
    expect(env["COLUMNS"]).toBe("188");
  });

  it("移除 NO_COLOR，避免托管输出丢失 Rich 颜色", () => {
    const env = build_core_process_env("http://127.0.0.1:3107", "token", "188");

    expect(env["NO_COLOR"]).toBeUndefined();
  });
});
