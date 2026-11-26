import type { JsonRecord } from "../domain/json";

/** 翻译、Agent 与接口测试共享同一执行占用。 */
export type RuntimeActivityOwner = "batch_translation" | "agent" | "model_test" | "project_write";

export type ProjectActivity = Readonly<{
  batchTranslation: boolean;
  agent: boolean;
  projectWrite: boolean;
  lastAgentRoundStartedAt?: number; // 后端单调时钟，关闭工程或重置对话时清空。
}>;

/** 后端与 renderer 共享的工程运行活动。 */
export type RuntimeActivitySnapshot = Readonly<
  JsonRecord & {
    revision: number; // 每次广播新快照时递增。
    owner: RuntimeActivityOwner | null;
    global?: { modelTest: boolean };
    projects?: Record<string, ProjectActivity>;
  }
>;

/** 活动变化发布完整快照，重连也从同一快照恢复。 */
export const RUNTIME_ACTIVITY_EVENT_TOPIC = "runtime.snapshot_changed";
