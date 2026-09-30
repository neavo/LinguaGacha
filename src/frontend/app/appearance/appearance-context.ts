import { createContext, useContext } from "react";
import type { ResolvedThemeMode } from "@gui/bridge-types";

export type ThemePreference = "system" | ResolvedThemeMode;
export type FontSizePreference = "normal" | "larger" | "largest";

/** 存储缺失或值失效时使用标准字体大小，菜单载荷共用此边界。 */
export function normalize_font_size(value: string | null): FontSizePreference {
  return value === "larger" || value === "largest" ? value : "normal";
}

export type FontPreference = "lg-base" | "system";

export type AppearanceContextValue = {
  theme_preference: ThemePreference;
  resolved_theme: ResolvedThemeMode;
  font_preference: FontPreference;
  font_size_preference: FontSizePreference;
  set_font_size_preference: (preference: FontSizePreference) => void;
  set_theme_preference: (preference: ThemePreference) => void;
  set_font_preference: (preference: FontPreference) => void;
};

export const AppearanceContext = createContext<AppearanceContextValue | null>(null);

/** 读取当前窗口外观状态，并拒绝绕过统一 provider 的消费者。 */
export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (value === null) {
    throw new Error("useAppearance must be used within AppearanceProvider.");
  }
  return value;
}
