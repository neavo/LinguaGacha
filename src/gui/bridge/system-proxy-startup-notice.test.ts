import { describe, expect, it } from "vitest";

import {
  EMPTY_DESKTOP_SYSTEM_PROXY_STARTUP_NOTICE,
  build_desktop_system_proxy_startup_notice_argument,
  resolve_desktop_system_proxy_startup_notice_from_argv,
} from "./system-proxy-startup-notice";

describe("system-proxy-startup-notice", () => {
  it("通过 preload argv 传递脱敏系统代理启动提示摘要", () => {
    const argument = build_desktop_system_proxy_startup_notice_argument({
      detected: true,
      proxiedOriginCount: 2,
      proxyDisplay: "http://127.0.0.1:7890",
    });

    expect(resolve_desktop_system_proxy_startup_notice_from_argv([argument])).toEqual({
      detected: true,
      proxiedOriginCount: 2,
      proxyDisplay: "http://127.0.0.1:7890",
    });
    expect(argument).not.toContain("user:password");
  });

  it("缺失或无代理摘要时返回空提示", () => {
    expect(resolve_desktop_system_proxy_startup_notice_from_argv([])).toBe(
      EMPTY_DESKTOP_SYSTEM_PROXY_STARTUP_NOTICE,
    );
    expect(
      resolve_desktop_system_proxy_startup_notice_from_argv([
        build_desktop_system_proxy_startup_notice_argument({
          detected: false,
          proxiedOriginCount: 0,
          proxyDisplay: null,
        }),
      ]),
    ).toBe(EMPTY_DESKTOP_SYSTEM_PROXY_STARTUP_NOTICE);
  });
});
