import type { Static, TSchema } from "@earendil-works/pi-ai";

import type { JsonRecord, JsonValue } from "../../../domain/json";
import type { QualityRuleKind } from "../../../domain/quality";
import type {
  AgentWorkspaceItem,
  AgentWorkspaceRuntimeContract,
  AgentWorkspaceWarning,
} from "../workspace/schema";

/** 内置方法通过具名数据流读取工作区快照。 */
export type AgentWorkspaceData = Readonly<{
  items: () => AsyncIterable<AgentWorkspaceItem>;
  warnings: () => AsyncIterable<AgentWorkspaceWarning>;
  quality: (kind: QualityRuleKind) => AsyncIterable<JsonRecord>;
}>;

export type AgentWorkspaceMethodContext = Readonly<{
  contract: AgentWorkspaceRuntimeContract;
  data: AgentWorkspaceData;
}>;

/** 单个领域方法共同拥有模型契约、用途和类型化实现。 */
export type AgentWorkspaceMethodDefinition<
  Parameters extends TSchema,
  Result extends TSchema,
> = Readonly<{
  useWhen: string;
  description: string;
  parameters: Parameters;
  result: Result;
  execute: (
    context: AgentWorkspaceMethodContext,
    args: Static<Parameters>,
  ) => Promise<Static<Result>>;
}>;

/** 保留 Schema 的具体类型，使参数、结果与实现共享同一份定义。 */
export function define_agent_workspace_method<
  const Parameters extends TSchema,
  const Result extends TSchema,
>(
  definition: AgentWorkspaceMethodDefinition<Parameters, Result>,
): AgentWorkspaceMethodDefinition<Parameters, Result> {
  return Object.freeze(definition);
}

/** 异构注册表在统一调用边界擦除具体 Schema。 */
export type AnyAgentWorkspaceMethodDefinition = Readonly<{
  useWhen: string;
  description: string;
  parameters: TSchema;
  result: TSchema;
  execute: (context: AgentWorkspaceMethodContext, args: never) => Promise<JsonValue>;
}>;
