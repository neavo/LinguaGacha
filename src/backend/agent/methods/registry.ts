import type { Static } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";

import type { JsonRecord, JsonValue } from "../../../domain/json";
import { deriveCommonLiteralRoots } from "./derive-common-literal-roots";
import { groupQualityRuleEntries } from "./group-quality-rule-entries";
import { matchLiterals } from "./match-literals";
import { queryItemContexts } from "./query-item-contexts";
import type { AgentWorkspaceMethodContext, AnyAgentWorkspaceMethodDefinition } from "./method";

/** 名称集合只在此列举；Schema、说明与实现分别由对应方法模块完整拥有。 */
export const AGENT_WORKSPACE_RUNTIME_METHODS = Object.freeze({
  queryItemContexts,
  groupQualityRuleEntries,
  deriveCommonLiteralRoots,
  matchLiterals,
});

export type AgentWorkspaceMethodName = keyof typeof AGENT_WORKSPACE_RUNTIME_METHODS;

export type AgentWorkspaceRuntimeMethods = Readonly<{
  [Name in AgentWorkspaceMethodName]: (
    args: Static<(typeof AGENT_WORKSPACE_RUNTIME_METHODS)[Name]["parameters"]>,
  ) => Promise<Static<(typeof AGENT_WORKSPACE_RUNTIME_METHODS)[Name]["result"]>>;
}>;

/** 未知参数只在统一入口按 Schema 收窄，结果再次校验以保护模型可见契约。 */
export async function execute_agent_workspace_method(
  name: AgentWorkspaceMethodName,
  context: AgentWorkspaceMethodContext,
  args: JsonRecord,
): Promise<JsonValue> {
  const method = AGENT_WORKSPACE_RUNTIME_METHODS[name] as AnyAgentWorkspaceMethodDefinition;
  if (!Check(method.parameters, args)) {
    throw new Error(`${name} args do not match the declared schema`);
  }
  const result = await method.execute(context, args as never);
  if (!Check(method.result, result)) {
    throw new Error(`${name} returned a value outside its declared schema`);
  }
  return result;
}
