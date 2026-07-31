import type { JsonRecord } from "../domain/json";

/** 普通任务与 Agent 共享的运行占用类型。 */
export type RuntimeActivityOwner = "task" | "agent";

/** 后端与 renderer 共享的轻量运行占用快照。 */
export type RuntimeActivitySnapshot = Readonly<
  JsonRecord & {
    revision: number; // owner 每次变化后单调递增
    owner: RuntimeActivityOwner | null; // null 表示 task 与 Agent 均未占用
  }
>;

/** 运行占用变化只发布完整快照，revision 用于丢弃迟到帧。 */
export const RUNTIME_ACTIVITY_EVENT_TOPIC = "runtime.snapshot_changed";
