/** 模型管理的两态连接快照，修订用于裁决 HTTP 与 SSE 的顺序。 */
export type ChatGPTAuthSnapshot = Readonly<{
  instance_id: string;
  revision: number;
  connected: boolean;
}>;

export const MODEL_AUTH_CHANGED_EVENT_TOPIC = "model.auth_changed";
