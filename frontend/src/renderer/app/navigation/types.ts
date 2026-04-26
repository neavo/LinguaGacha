import type { LocaleKey } from "@/i18n";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export type RouteId =
  | "project-home"
  | "model"
  | "proofreading"
  | "workbench"
  | "basic-settings"
  | "expert-settings"
  | "glossary"
  | "text-preserve"
  | "text-replacement"
  | "pre-translation-replacement"
  | "post-translation-replacement"
  | "custom-prompt"
  | "translation-prompt"
  | "analysis-prompt"
  | "laboratory"
  | "toolbox"
  | "name-field-extraction"
  | "ts-conversion";

type NavigationNode = {
  id: RouteId;
  icon: LucideIcon;
  title_key: LocaleKey;
  children?: NavigationNode[];
};

export type NavigationGroup = {
  id: string;
  items: NavigationNode[];
};

export type BottomActionId = "theme" | "language" | "logs";

export type AppearanceMenuActionId = "theme-mode" | "font-family";

export type BottomAction = {
  id: BottomActionId;
  label_key: LocaleKey;
  icon: LucideIcon;
};

export type ScreenComponentProps = {
  is_sidebar_collapsed: boolean;
};

type ScreenModule = {
  component: ComponentType<ScreenComponentProps>;
  title_key: LocaleKey;
};

export type ScreenRegistry = Partial<Record<RouteId, ScreenModule>>;
