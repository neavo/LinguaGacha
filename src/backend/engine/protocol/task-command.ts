import type { TaskStartMode, TaskType, TranslationScope } from "../../../domain/task";

/** StartTaskCommand 是 API 命令层交给 Engine 的唯一启动命令形状 */
export type StartTaskCommand =
  | {
      task_type: "translation";
      mode: TaskStartMode; // mode 只描述本轮启动语义，不参与状态机
      scope: TranslationScope; // scope 是普通翻译与重翻的唯一分叉
      expected_section_revisions: Record<string, number>; // revision 锁保护后台任务输入不基于旧快照运行
    }
  | {
      task_type: "analysis";
      mode: TaskStartMode;
      expected_section_revisions: Record<string, number>;
    };

/** StopTaskCommand 只按 TaskType 停止；items scope 重翻停止归入 translation */
export type StopTaskCommand = {
  task_type: TaskType;
};
