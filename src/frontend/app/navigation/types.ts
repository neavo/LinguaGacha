import type { LocaleKey } from "@frontend/app/locale/locale-provider";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export type RouteId =
  | "project-home"
  | "model"
  | "agent"
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
  | "laboratory"
  | "toolbox"
  | "ts-conversion";

/** 规则页跳转到校对页时只传一次性搜索条件，不携带页面筛选缓存。 */
export type ProofreadingLookupIntent = {
  keyword: string;
  is_regex: boolean;
  scope: "src" | "dst" | "all";
};

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

export type ScreenComponentProps = {
  is_sidebar_collapsed: boolean;
};

type ScreenModule = {
  component: ComponentType<ScreenComponentProps>;
  title_key: LocaleKey;
  /** 缺省页面使用 Shell 标准边距；沉浸式工作面显式占满 WorkspaceFrame。 */
  workspace_layout?: "edge-to-edge";
};

export type ScreenRegistry = Partial<Record<RouteId, ScreenModule>>;
