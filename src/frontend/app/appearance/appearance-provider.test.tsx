import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

import {
  AppearanceProvider,
  useAppearance,
  type FontPreference,
  type ThemePreference,
} from "./appearance-provider";

let system_dark = false;
const system_theme_listeners = new Set<(event: MediaQueryListEvent) => void>();
const system_theme_query = {
  get matches(): boolean {
    return system_dark;
  },
  media: "(prefers-color-scheme: dark)",
  onchange: null,
  addListener(listener: (event: MediaQueryListEvent) => void): void {
    system_theme_listeners.add(listener);
  },
  removeListener(listener: (event: MediaQueryListEvent) => void): void {
    system_theme_listeners.delete(listener);
  },
  addEventListener(_type: string, listener: (event: MediaQueryListEvent) => void): void {
    system_theme_listeners.add(listener);
  },
  removeEventListener(_type: string, listener: (event: MediaQueryListEvent) => void): void {
    system_theme_listeners.delete(listener);
  },
  dispatchEvent(): boolean {
    return true;
  },
} as MediaQueryList;

function set_system_theme(is_dark: boolean): void {
  system_dark = is_dark;
  for (const listener of system_theme_listeners) {
    listener(system_theme_query as unknown as MediaQueryListEvent);
  }
}

type AppearanceSnapshot = {
  font_preference: FontPreference;
  resolved_theme: "light" | "dark";
  theme_preference: ThemePreference;
};

function AppearanceProbe(props: {
  on_snapshot: (snapshot: AppearanceSnapshot) => void;
}): JSX.Element {
  const appearance = useAppearance();

  useEffect(() => {
    props.on_snapshot({
      font_preference: appearance.font_preference,
      resolved_theme: appearance.resolved_theme,
      theme_preference: appearance.theme_preference,
    });
  }, [appearance, props]);

  return (
    <>
      <button onClick={() => appearance.set_font_preference("system")}>system-font</button>
      <button onClick={() => appearance.set_theme_preference("dark")}>dark-theme</button>
    </>
  );
}

describe("AppearanceProvider", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  const set_title_bar_theme = vi.fn();

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
    delete document.documentElement.dataset.lgBaseFont;
    system_dark = false;
    system_theme_listeners.clear();
    set_title_bar_theme.mockReset();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => system_theme_query),
    });
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      writable: true,
      value: create_desktop_bridge_api_mock({
        methods: { setTitleBarTheme: set_title_bar_theme },
      }),
    });
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  async function render_provider(snapshots: AppearanceSnapshot[]): Promise<HTMLDivElement> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(
        <AppearanceProvider>
          <AppearanceProbe on_snapshot={(snapshot) => snapshots.push(snapshot)} />
        </AppearanceProvider>,
      );
    });
    return container;
  }

  it("以系统主题和 LGBase 作为未配置用户的明确偏好", async () => {
    const snapshots: AppearanceSnapshot[] = [];
    const view = await render_provider(snapshots);

    expect(snapshots.at(-1)).toEqual({
      font_preference: "lg-base",
      resolved_theme: "light",
      theme_preference: "system",
    });
    expect(document.documentElement.dataset.lgBaseFont).toBe("enabled");
    expect(set_title_bar_theme).toHaveBeenLastCalledWith("light");

    await act(async () => {
      view.querySelector<HTMLButtonElement>("button:nth-of-type(2)")?.click();
    });
    expect(snapshots.at(-1)?.theme_preference).toBe("dark");
    expect(window.localStorage.getItem("lg-theme-mode")).toBe("dark");
  });

  it("同步字体存储事件和解析后的窗口主题", async () => {
    const snapshots: AppearanceSnapshot[] = [];
    await render_provider(snapshots);

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "lg-base-font-mode",
          newValue: "disabled",
        }),
      );
    });
    expect(snapshots.at(-1)?.font_preference).toBe("system");
    expect(document.documentElement.dataset.lgBaseFont).toBe("disabled");

    await act(async () => {
      set_system_theme(true);
    });
    expect(snapshots.at(-1)?.resolved_theme).toBe("dark");
    expect(set_title_bar_theme).toHaveBeenLastCalledWith("dark");
  });

  it("保留用户已明确保存的主题而不受系统主题覆盖", async () => {
    system_dark = true;
    window.localStorage.setItem("lg-theme-mode", "light");
    const snapshots: AppearanceSnapshot[] = [];
    await render_provider(snapshots);

    expect(snapshots.at(-1)?.theme_preference).toBe("light");
    expect(snapshots.at(-1)?.resolved_theme).toBe("light");
    expect(set_title_bar_theme).toHaveBeenLastCalledWith("light");
  });
});
