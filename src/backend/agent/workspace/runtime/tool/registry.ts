import type { Static } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";

import type { JsonRecord, JsonValue } from "../../../../../domain/json";
import { deriveCommonLiteralRoots } from "./derive-common-literal-roots";
import { groupQualityRuleEntries } from "./group-quality-rule-entries";
import { matchLiterals } from "./match-literals";
import { queryItemContexts } from "./query-item-contexts";
import type {
  AgentWorkspaceDataToolContext,
  AnyAgentWorkspaceDataToolDefinition,
} from "./data-tool";

/** 名称集合只在此列举；Schema、说明与实现分别由对应数据工具模块完整拥有。 */
export const AGENT_WORKSPACE_DATA_TOOLS: Readonly<{
  queryItemContexts: typeof queryItemContexts;
  groupQualityRuleEntries: typeof groupQualityRuleEntries;
  deriveCommonLiteralRoots: typeof deriveCommonLiteralRoots;
  matchLiterals: typeof matchLiterals;
}> = Object.freeze({
  queryItemContexts,
  groupQualityRuleEntries,
  deriveCommonLiteralRoots,
  matchLiterals,
});

export type AgentWorkspaceDataToolName = keyof typeof AGENT_WORKSPACE_DATA_TOOLS;

export type AgentWorkspaceDataTools = Readonly<{
  [Name in AgentWorkspaceDataToolName]: (
    args: Static<(typeof AGENT_WORKSPACE_DATA_TOOLS)[Name]["parameters"]>,
  ) => Promise<Static<(typeof AGENT_WORKSPACE_DATA_TOOLS)[Name]["result"]>>;
}>;

/** 未知参数只在统一入口按 Schema 收窄，结果再次校验以保护模型可见契约。 */
export async function execute_agent_workspace_data_tool(
  name: AgentWorkspaceDataToolName,
  context: AgentWorkspaceDataToolContext,
  args: JsonRecord,
): Promise<JsonValue> {
  const tool = AGENT_WORKSPACE_DATA_TOOLS[name] as AnyAgentWorkspaceDataToolDefinition;
  if (!Check(tool.parameters, args)) {
    throw new Error(`${name} args do not match the declared schema`);
  }
  const result = await tool.execute(context, args as never);
  if (!Check(tool.result, result)) {
    throw new Error(`${name} returned a value outside its declared schema`);
  }
  return result;
}
