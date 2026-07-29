import type { JsonRecord } from "../domain/json";

/** AgentService 与 renderer 共享的唯一 SSE topic。 */
export const AGENT_SESSION_EVENT_TOPIC = "agent.session_event";

/** 启动期 skill 清单只公开能力选择所需的最小字段。 */
export type AgentSkillSnapshot = JsonRecord & {
  name: string;
  description: string;
};

/** 单会话终态保留 complete，和用户主动 stop/reset 后的 idle 区分。 */
export type AgentSessionState = "idle" | "running" | "complete";

/** renderer 可恢复的公开消息投影，不暴露供应商消息或思考块。 */
export type AgentMessageSnapshot = JsonRecord & {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  complete: boolean;
};

/** 工具状态以 toolCallId 覆盖更新，避免一次调用产生平行记录。 */
export type AgentToolStatus = JsonRecord & {
  toolCallId: string;
  toolName: string;
  status: "running" | "success" | "error";
};

/** GET snapshot、命令响应与 snapshot_seed 共用的完整会话形状。 */
export type AgentSessionSnapshot = JsonRecord & {
  state: AgentSessionState;
  messages: AgentMessageSnapshot[];
  toolStatuses: AgentToolStatus[];
  skills: AgentSkillSnapshot[];
};

/**
 * SSE 只发送可幂等合并的增量；无法安全合并时由 snapshot_seed 或 GET 恢复。
 */
export type AgentSessionEvent = JsonRecord &
  (
    | {
        type: "message_delta";
        messageId: string;
        role: AgentMessageSnapshot["role"];
        delta: string;
        offset: number; // delta 在当前消息文本中的 UTF-16 长度偏移，用于拒绝重复帧和缺帧
        createdAt: number;
        complete: boolean;
      }
    | ({ type: "tool_status" } & AgentToolStatus)
    | { type: "session_state"; state: AgentSessionState }
    | { type: "snapshot_seed"; snapshot: AgentSessionSnapshot }
    | { type: "request_failed" }
  );
