import type { LocaleKey } from "@frontend/app/locale/locale-context";
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
  | "skills"
  | "text-preserve"
  | "text-replacement"
  | "pre-translation-replacement"
  | "post-translation-replacement"
  | "custom-prompt"
  | "laboratory";

/** 规则页跳转到校对页时只传一次性搜索条件，不携带页面筛选缓存。 */
export type ProofreadingLookupIntent = {
  keyword: string;
  is_regex: boolean;
  scope: "src" | "dst" | "all";
};

/** 随导航交给 Agent 的一次性输入请求，选区使用最终正文的字符位置。 */
export type AgentInputRequest = Readonly<{
  text: string;
  mode: "replace" | "if-empty";
  selection?: Readonly<{ from: number; to: number }>;
}>;

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
