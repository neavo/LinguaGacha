import { describe, expectTypeOf, it } from "vitest";

import type {
  DesktopBackendApiInfo,
  DesktopPathPickResult,
  DesktopPlatform,
  DesktopRendererDiagnosticsPayload,
  DesktopShellInfo,
  DesktopSystemProxyStartupNotice,
  ThemeMode,
  TitleBarControlSide,
} from "./bridge-types";

describe("bridge-types", () => {
  it("桌面桥接契约保持可序列化的 renderer 消费形状", () => {
    expectTypeOf<ThemeMode>().toEqualTypeOf<"light" | "dark">();
    expectTypeOf<TitleBarControlSide>().toEqualTypeOf<"left" | "right" | "none">();
    expectTypeOf<DesktopPlatform>().toMatchTypeOf<string>();
    expectTypeOf<DesktopSystemProxyStartupNotice>().toMatchTypeOf<{
      detected: boolean;
      proxiedOriginCount: number;
      proxyDisplay: string | null;
    }>();
    expectTypeOf<DesktopBackendApiInfo>().toMatchTypeOf<{
      baseUrl: string;
      systemProxyStartupNotice: DesktopSystemProxyStartupNotice;
    }>();
    expectTypeOf<DesktopShellInfo>().toMatchTypeOf<{
      platform: DesktopPlatform;
      usesTitleBarOverlay: boolean;
      titleBarHeight: number;
      titleBarControlSide: TitleBarControlSide;
      titleBarSafeAreaStart: number;
      titleBarSafeAreaEnd: number;
    }>();
    expectTypeOf<DesktopPathPickResult>().toMatchTypeOf<{
      canceled: boolean;
      paths: string[];
    }>();
    expectTypeOf<DesktopRendererDiagnosticsPayload>().toMatchTypeOf<object>();
  });
});
