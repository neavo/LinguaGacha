import { useCallback, useRef } from "react";

import {
  capture_renderer_error,
  type RendererErrorSource,
} from "@/app/diagnostics/renderer-error-reporter";
import type { TaskSnapshot } from "@/app/desktop/task-runtime-store";
import type { LogErrorContextInput, RendererErrorContextInput } from "@shared/error";
import type { TaskType } from "@shared/task";

export type RuntimeErrorReportArgs = {
  source: Extract<
    RendererErrorSource,
    "sse" | "project-mutation" | "settings" | "scheduler" | "runtime-recovery"
  >; // source 限定为运行态错误来源
  triggeringEvent?: LogErrorContextInput; // triggeringEvent 与 renderer error report 同形
  context?: RendererErrorContextInput; // context 只允许 renderer error 白名单字段
};

export type DesktopRuntimeRecoveryActions = {
  report_runtime_error: (error: unknown, args: RuntimeErrorReportArgs) => void;
  refresh_task_after_runtime_error: (
    reason: string,
    triggering_event: LogErrorContextInput | undefined,
    task_type?: TaskType,
  ) => Promise<void>;
  refresh_project_runtime_after_error: (
    reason: string,
    triggering_event: LogErrorContextInput | undefined,
    recovery_context?: RendererErrorContextInput,
  ) => Promise<void>;
};

type DesktopRuntimeRecoveryOptions = {
  project_loaded: boolean; // project_loaded 决定项目恢复是否有权访问后端项目主链路
  project_path: string; // project_path 为空时不尝试项目恢复刷新
  refresh_project_runtime: () => Promise<void>; // refresh_project_runtime 回到 manifest + read-sections 主链路
  refresh_task: (task_type?: TaskType) => Promise<TaskSnapshot>; // refresh_task 回到后端 task snapshot 主链路
};

type ProjectRuntimeRecoveryJob = {
  project_path: string; // project_path 是去重身份，项目切换后必须允许新恢复独立启动
  promise: Promise<void>; // promise 代表当前项目唯一恢复流程，调用方共享完成信号
};

const DEFAULT_TASK_RECOVERY_KEY = "__default_task__"; // 未指定 task_type 的恢复共享默认快照身份

/**
 * 运行态恢复策略集中在这里，Provider 只负责注册事件和写入共享 store。
 */
export function useDesktopRuntimeRecovery(
  options: DesktopRuntimeRecoveryOptions,
): DesktopRuntimeRecoveryActions {
  const { project_loaded, project_path, refresh_project_runtime, refresh_task } = options;
  const project_recovery_ref = useRef<ProjectRuntimeRecoveryJob | null>(null);
  const task_recovery_ref = useRef<Map<string, Promise<void>>>(new Map());

  const report_runtime_error = useCallback((error: unknown, args: RuntimeErrorReportArgs): void => {
    capture_renderer_error(error, {
      source: args.source,
      triggeringEvent: args.triggeringEvent,
      context: args.context,
    });
  }, []);

  // 同一 task_type 的恢复共享一个 snapshot 请求，避免错误风暴重复覆盖 TaskRuntimeStore。
  const refresh_task_after_runtime_error = useCallback(
    async (
      reason: string,
      triggering_event: LogErrorContextInput | undefined,
      task_type?: TaskType,
    ): Promise<void> => {
      const recovery_key = task_type ?? DEFAULT_TASK_RECOVERY_KEY;
      const current_recovery = task_recovery_ref.current.get(recovery_key);
      if (current_recovery !== undefined) {
        await current_recovery;
        return;
      }

      let recovery_promise!: Promise<void>;
      recovery_promise = refresh_task(task_type)
        .then(() => undefined)
        .catch((error: unknown) => {
          report_runtime_error(error, {
            source: "runtime-recovery",
            triggeringEvent: triggering_event,
            context: { reason, recovery: "task_snapshot" },
          });
        })
        .finally(() => {
          if (task_recovery_ref.current.get(recovery_key) === recovery_promise) {
            task_recovery_ref.current.delete(recovery_key);
          }
        });

      task_recovery_ref.current.set(recovery_key, recovery_promise);
      await recovery_promise;
    },
    [refresh_task, report_runtime_error],
  );

  // 同一 project path 的恢复共享一个 session 初始化流程，请求方可 await 同一完成信号。
  const refresh_project_runtime_after_error = useCallback(
    async (
      reason: string,
      triggering_event: LogErrorContextInput | undefined,
      recovery_context: RendererErrorContextInput = {},
    ): Promise<void> => {
      const current_project_path = project_path.trim();
      if (!project_loaded || current_project_path === "") {
        return;
      }

      const current_recovery = project_recovery_ref.current;
      if (current_recovery?.project_path === current_project_path) {
        await current_recovery.promise;
        return;
      }

      let recovery_promise!: Promise<void>;
      recovery_promise = refresh_project_runtime()
        .catch((error: unknown) => {
          report_runtime_error(error, {
            source: "runtime-recovery",
            triggeringEvent: triggering_event,
            context: { ...recovery_context, reason, recovery: "project_runtime" },
          });
        })
        .finally(() => {
          if (project_recovery_ref.current?.promise === recovery_promise) {
            project_recovery_ref.current = null;
          }
        });

      project_recovery_ref.current = {
        project_path: current_project_path,
        promise: recovery_promise,
      };
      await recovery_promise;
    },
    [project_loaded, project_path, refresh_project_runtime, report_runtime_error],
  );

  return {
    report_runtime_error,
    refresh_task_after_runtime_error,
    refresh_project_runtime_after_error,
  };
}
