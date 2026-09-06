import { describe, expect, it } from "vitest";

import { DesktopApiError } from "@frontend/app/desktop/desktop-api";
import { resolve_visible_error_message } from "./visible-error-message";
import type { LocaleKey } from "@shared/i18n";

describe("resolve_visible_error_message", () => {
  it("按 DesktopApiError code 和 details 解析本地化展示文案", () => {
    const error = DesktopApiError.local("network_failed", { path: "/api/batch-translation/start" });

    const message = resolve_visible_error_message(
      error,
      (key: LocaleKey, params?: Record<string, string>) => {
        expect(key).toBe("app.error.desktop.network_failed.message");
        return `网络请求失败：${params?.PATH ?? ""}`;
      },
      "操作失败",
    );

    expect(message).toBe("网络请求失败：/api/batch-translation/start");
  });

  it("普通 Error 不直接穿透为用户可见文案", () => {
    const message = resolve_visible_error_message(
      new Error("本地校验失败"),
      (key: LocaleKey) => key,
      "操作失败",
    );

    expect(message).toBe("操作失败");
  });
});
