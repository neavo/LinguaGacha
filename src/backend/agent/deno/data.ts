import { Check } from "typebox/value";

import type { JsonRecord } from "../../../domain/json";
import type { QualityRuleKind } from "../../../domain/quality";
import {
  AGENT_WORKSPACE_CONTRACT_SCHEMA,
  type AgentWorkspaceItem,
  type AgentWorkspaceRuntimeContract,
  type AgentWorkspaceWarning,
} from "../workspace/schema";
import type { AgentWorkspaceMethodContext } from "../methods/method";

/** Deno entry 独占真实文件端口；领域方法只消费按数据集命名的类型化流。 */
export type AgentWorkspaceReadPort = Readonly<{
  contract: JsonRecord;
  iterateJsonl: (filePath: string) => AsyncIterable<JsonRecord>;
}>;

/** 工作区快照由宿主按 contract 生成；此处只解析一次路径与限制，不在每个算法中重复拆 JsonRecord。 */
export function create_agent_workspace_method_context(
  read_port: AgentWorkspaceReadPort,
): AgentWorkspaceMethodContext {
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
