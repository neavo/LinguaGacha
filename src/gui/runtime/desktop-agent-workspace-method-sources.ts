import deriveCommonLiteralRootsSource from "./agent-workspace-methods/derive-common-literal-roots.js?raw";
import queryItemContextsSource from "./agent-workspace-methods/query-item-contexts.js?raw";
import queryItemsSource from "./agent-workspace-methods/query-items.js?raw";
import groupQualityRuleEntriesSource from "./agent-workspace-methods/query-quality-rule-groups.js?raw";

/** 约束实现集合与 shared 中的模型可见方法契约保持一一对应。 */
type PublishedWorkspaceMethodName =
  keyof typeof import("../../shared/backend-runtime").AGENT_WORKSPACE_PUBLISHED_METHOD_API;

/** 固定方法随 Electron bundle 发布，工作区快照只承载工程数据。 */
export const AGENT_WORKSPACE_METHOD_SOURCES = Object.freeze({
  queryItems: queryItemsSource,
  queryItemContexts: queryItemContextsSource,
  groupQualityRuleEntries: groupQualityRuleEntriesSource,
  deriveCommonLiteralRoots: deriveCommonLiteralRootsSource,
} satisfies Record<PublishedWorkspaceMethodName, string>);
