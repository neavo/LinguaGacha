import type { LocaleKey } from "@frontend/app/locale/locale-context";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

export type RouteId =
  | "project-home"
  | "model"
  | "agent"
  | "proofreading"
  | "workbench"
  | "function-settings"
  | "glossary"
  | "skills"
  | "text-preserve"
  | "pre-translation-replacement"
  | "post-translation-replacement"
  | "custom-prompt"
  | "laboratory"
  | "toolbox"
  | "game-font"
  | "translation-transfer";

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

type NavigationItem = {
  id: RouteId;
  icon: LucideIcon;
  title_key: LocaleKey;
};

export type NavigationGroup = {
  id: string;
  items: NavigationItem[];
};

export type ScreenComponentProps = {
  is_sidebar_collapsed: boolean;
};

type ScreenModule = {
  component: ComponentType<ScreenComponentProps>;
  title_key: LocaleKey;
  /** 缺省页面使用 Shell 标准边距。沉浸式工作面显式占满 `WorkspaceFrame`。 */
  workspace_layout?: "edge-to-edge";
};

// 每个路由必须注册真实页面，壳层直接按路由渲染。
export type ScreenRegistry = Record<RouteId, ScreenModule>;
