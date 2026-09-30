import { Type } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";

import { normalize_agent_doing } from "../../../shared/agent-doing";
import { create_schema_renderer } from "../workspace/schema-description";
import type { AgentWorkspaceRequestChannel } from "../workspace/runtime/request-channel";

/** Schema 校验跨进程请求形状，文本边界统一由共享规范化函数维护。 */
export const WORKSPACE_DOING_REQUEST_SCHEMA = Type.Object(
  {
    kind: Type.Literal("doing"),
    text: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

/** 参数声明与父进程校验共用 Schema，状态归当前会话持有。 */
export function describe_doing(): string {
  const text = create_schema_renderer(new Map()).render(
    WORKSPACE_DOING_REQUEST_SCHEMA.properties.text,
  );
  return [
    "/**",
    ` * - 设置当前任务的处理阶段，新文本立即覆盖，完成、放弃或结束处理时传入 null 清空，内容跨回合保留。`,
    " */",
    `doing(text: ${text}): Promise<void>;`,
  ].join("\n");
}

/** 等待宿主完成写入，后续脚本失败不回滚已生效的阶段。 */
export function bind_doing(channel: Pick<AgentWorkspaceRequestChannel, "call">) {
  return async (text: string | null): Promise<void> => {
    await channel.call({ kind: "doing", text });
  };
}

/** 父进程校验脚本输入后同步更新会话，成功回包无需等待整个程序退出。 */
export function execute_doing_request(
  request: unknown,
  signal: AbortSignal,
  write: ((text: string | null) => void) | undefined,
): null {
  signal.throwIfAborted();
  if (!Check(WORKSPACE_DOING_REQUEST_SCHEMA, request))
    throw new Error("Invalid workspace doing request.");
  if (!write) throw new Error("Workspace doing unavailable.");
  write(normalize_agent_doing(request.text));
  return null;
}
