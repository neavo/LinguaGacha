import { ThemeProvider, useTheme } from "next-themes";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type { ResolvedThemeMode } from "@gui/bridge-types";

const THEME_STORAGE_KEY = "lg-theme-mode"; // 跨窗口持久化契约，由 next-themes 负责同步
const FONT_FAMILY_STORAGE_KEY = "lg-base-font-mode"; // 沿用 enabled / disabled 存储值，避免迁移既有偏好

export type ThemePreference = "system" | ResolvedThemeMode;
export type FontPreference = "lg-base" | "system";

type AppearanceContextValue = {
  theme_preference: ThemePreference;
  resolved_theme: ResolvedThemeMode;
  font_preference: FontPreference;
  set_theme_preference: (preference: ThemePreference) => void;
  set_font_preference: (preference: FontPreference) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function normalize_theme_preference(theme: string | undefined): ThemePreference {
  // next-themes 的公开类型允许任意主题名，进入应用状态前必须收窄到产品支持的三种偏好。
  if (theme === "light" || theme === "dark" || theme === "system") {
    return theme;
  }
  return "system";
}

function resolve_theme_mode(resolved_theme: string | undefined): ResolvedThemeMode {
  // next-themes 首次解析前可能没有值，此时根节点类名是当前窗口最可靠的首帧结果。
  if (resolved_theme === "light" || resolved_theme === "dark") {
    return resolved_theme;
  }
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function read_font_preference(): FontPreference {
  return window.localStorage.getItem(FONT_FAMILY_STORAGE_KEY) === "disabled" ? "system" : "lg-base";
}

function serialize_font_preference(preference: FontPreference): "enabled" | "disabled" {
  return preference === "lg-base" ? "enabled" : "disabled";
}

function AppearanceStateProvider({ children }: { children: ReactNode }): JSX.Element {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [font_preference, set_font_preference] = useState<FontPreference>(() =>
    read_font_preference(),
  );
  const theme_preference = normalize_theme_preference(theme);
  const resolved_theme = resolve_theme_mode(resolvedTheme);

  useEffect(() => {
    // 字体偏好不由 next-themes 管理，因此在这里统一投影到 DOM 和跨窗口存储。
    const stored_preference = serialize_font_preference(font_preference);
    document.documentElement.dataset.lgBaseFont = stored_preference;
    if (window.localStorage.getItem(FONT_FAMILY_STORAGE_KEY) !== stored_preference) {
      window.localStorage.setItem(FONT_FAMILY_STORAGE_KEY, stored_preference);
    }
  }, [font_preference]);

  useEffect(() => {
    // storage 事件只会送达其他窗口；当前窗口由 set_font_preference 立即更新。
    function handle_storage(event: StorageEvent): void {
      if (event.key === FONT_FAMILY_STORAGE_KEY) {
        set_font_preference(event.newValue === "disabled" ? "system" : "lg-base");
      }
    }

    window.addEventListener("storage", handle_storage);
    return () => {
      window.removeEventListener("storage", handle_storage);
    };
  }, []);

  useEffect(() => {
    // 宿主只消费最终明暗状态，不承担 system 偏好的解析和持久化。
    window.desktopApp.setTitleBarTheme(resolved_theme);
  }, [resolved_theme]);

  const value: AppearanceContextValue = {
    theme_preference,
    resolved_theme,
    font_preference,
    set_theme_preference: setTheme,
    set_font_preference,
  };

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

/** 统一拥有 renderer 窗口的外观偏好、系统主题解析与宿主视觉同步。 */
export function AppearanceProvider({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey={THEME_STORAGE_KEY}
    >
      <AppearanceStateProvider>{children}</AppearanceStateProvider>
    </ThemeProvider>
  );
}

/** 读取当前窗口外观状态，并拒绝绕过统一 provider 的消费者。 */
export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (value === null) {
    throw new Error("useAppearance must be used within AppearanceProvider.");
  }
  return value;
}
