import type { Static, TSchema } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";

import type { JsonRecord, JsonValue } from "../../../../../domain/json";
import type { QualityRuleKind } from "../../../../../domain/quality";
import type {
  AgentWorkspaceItem,
  AgentWorkspaceRuntimeContract,
  AgentWorkspaceWarning,
} from "../../schema";
import { AGENT_WORKSPACE_CONTRACT_SCHEMA } from "../../schema";

/** 内置数据工具通过具名数据流读取工作区快照。 */
export type AgentWorkspaceData = Readonly<{
  items: () => AsyncIterable<AgentWorkspaceItem>;
  warnings: () => AsyncIterable<AgentWorkspaceWarning>;
  quality: (kind: QualityRuleKind) => AsyncIterable<JsonRecord>;
}>;

/** Deno entry 独占真实文件端口；数据工具只消费按数据集命名的类型化流。 */
export type AgentWorkspaceReadPort = Readonly<{
  contract: JsonRecord;
  iterateJsonl: (filePath: string) => AsyncIterable<JsonRecord>;
}>;

export type AgentWorkspaceDataToolContext = Readonly<{
  contract: AgentWorkspaceRuntimeContract;
  data: AgentWorkspaceData;
}>;

/** 工作区快照由宿主按 contract 生成；此处统一解析路径与限制。 */
export function create_agent_workspace_data_tool_context(
  read_port: AgentWorkspaceReadPort,
): AgentWorkspaceDataToolContext {
  if (!Check(AGENT_WORKSPACE_CONTRACT_SCHEMA, read_port.contract)) {
    throw new Error("Workspace contract does not match the runtime schema.");
  }
  const contract = read_port.contract as unknown as AgentWorkspaceRuntimeContract;

  function iterate_dataset<Row>(name: string): AsyncIterable<Row> {
    const dataset = contract.datasets[name];
    if (dataset === undefined) throw new Error(`Workspace dataset is missing: ${name}`);
    return read_port.iterateJsonl(dataset.path) as AsyncIterable<Row>;
  }

  return Object.freeze({
    contract,
    data: Object.freeze({
      items: () => iterate_dataset<AgentWorkspaceItem>("items"),
      warnings: () => iterate_dataset<AgentWorkspaceWarning>("warnings"),
      quality: (kind: QualityRuleKind) => iterate_dataset<JsonRecord>(kind),
    }),
  });
}

/** 单个数据工具共同拥有模型契约、用途和类型化实现。 */
export type AgentWorkspaceDataToolDefinition<
  Parameters extends TSchema,
  Result extends TSchema,
> = Readonly<{
  useWhen: string;
  description: string;
  parameters: Parameters;
  result: Result;
  execute: (
    context: AgentWorkspaceDataToolContext,
    args: Static<Parameters>,
  ) => Promise<Static<Result>>;
}>;

/** 保留 Schema 的具体类型，使参数、结果与实现共享同一份定义。 */
export function define_agent_workspace_data_tool<
  const Parameters extends TSchema,
  const Result extends TSchema,
>(
  definition: AgentWorkspaceDataToolDefinition<Parameters, Result>,
): AgentWorkspaceDataToolDefinition<Parameters, Result> {
  return Object.freeze(definition);
}

/** 异构注册表在统一调用边界擦除具体 Schema。 */
export type AnyAgentWorkspaceDataToolDefinition = Readonly<{
  useWhen: string;
  description: string;
  parameters: TSchema;
  result: TSchema;
  execute: (context: AgentWorkspaceDataToolContext, args: never) => Promise<JsonValue>;
}>;
