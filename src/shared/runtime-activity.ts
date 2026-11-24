import type { JsonRecord } from "../domain/json";

/** 翻译、Agent 与接口测试共享同一执行占用。 */
export type RuntimeActivityOwner = "batch_translation" | "agent" | "model_test" | "project_write";

export type ProjectActivity = Readonly<{
  batchTranslation: boolean;
  agent: boolean;
  projectWrite: boolean;
}>;

/** 后端与 renderer 共享的轻量运行占用快照。 */
export type RuntimeActivitySnapshot = Readonly<
  JsonRecord & {
    revision: number; // owner 每次变化后单调递增
    owner: RuntimeActivityOwner | null;
    global?: { modelTest: boolean };
    projects?: Record<string, ProjectActivity>;
  }
>;

/** 运行占用变化只发布完整快照，revision 用于丢弃迟到帧。 */
export const RUNTIME_ACTIVITY_EVENT_TOPIC = "runtime.snapshot_changed";
