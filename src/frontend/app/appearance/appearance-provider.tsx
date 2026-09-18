import { ThemeProvider, useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import type { ResolvedThemeMode } from "@gui/bridge-types";
import {
  type ThemePreference,
  type FontPreference,
  type AppearanceContextValue,
  AppearanceContext,
} from "./appearance-context";

const THEME_STORAGE_KEY = "lg-theme-mode"; // 跨窗口持久化契约，由 next-themes 负责同步
const FONT_FAMILY_STORAGE_KEY = "lg-base-font-mode"; // 沿用 enabled / disabled 存储值，避免迁移既有偏好

/** 将 next-themes 的任意主题名收窄为应用支持的三种偏好。 */
function normalize_theme_preference(theme: string | undefined): ThemePreference {
  if (theme === "light" || theme === "dark" || theme === "system") {
    return theme;
  }
  return "system";
}

/** 主题解析前从根节点读取首屏实际明暗。 */
function resolve_theme_mode(resolved_theme: string | undefined): ResolvedThemeMode {
  if (resolved_theme === "light" || resolved_theme === "dark") {
    return resolved_theme;
  }
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** 将持久化字体开关转换为界面偏好。 */
function read_font_preference(): FontPreference {
  return window.localStorage.getItem(FONT_FAMILY_STORAGE_KEY) === "disabled" ? "system" : "lg-base";
}

/** 字体偏好写回既有存储值，供其他窗口同步。 */
function serialize_font_preference(preference: FontPreference): "enabled" | "disabled" {
  return preference === "lg-base" ? "enabled" : "disabled";
}

/** 汇合主题组件状态与字体偏好，投影到页面和宿主。 */
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
