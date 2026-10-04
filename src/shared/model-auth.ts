import type { ApiErrorPayload } from "./error";

/** 最近一次授权的结果留在运行态，重连快照也能结束对应模态窗。 */
export type ChatGPTLoginSnapshot = Readonly<
  | { id: string; status: "pending" | "succeeded" | "cancelled" }
  | { id: string; status: "failed"; error: Readonly<ApiErrorPayload> }
>;

/** 模型管理的两态连接快照，修订用于裁决 HTTP 与 SSE 的顺序。 */
export type ChatGPTAuthSnapshot = Readonly<{
  instance_id: string;
  revision: number;
  connected: boolean;
  login: ChatGPTLoginSnapshot | null;
}>;

export type ChatGPTLoginResponse = Readonly<{
  id: string;
  url: string;
  snapshot: ChatGPTAuthSnapshot;
}>;

export const MODEL_AUTH_CHANGED_EVENT_TOPIC = "model.auth_changed";
