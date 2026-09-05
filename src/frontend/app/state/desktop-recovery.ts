import { useCallback, useRef } from "react";

import {
  capture_renderer_error,
  type RendererErrorSource,
} from "@frontend/app/diagnostics/renderer-error-reporter";
import { type BatchTranslationSnapshot } from "@domain/batch-translation";

import type { LogErrorContextInput, RendererErrorContextInput } from "@shared/error";

export type StateErrorReportArgs = {
  source: Extract<
    RendererErrorSource,
    "sse" | "project-write" | "settings" | "scheduler" | "state-recovery"
  >; // source 限定为 state 错误来源
  triggeringEvent?: LogErrorContextInput; // 与 renderer error report 同形
  context?: RendererErrorContextInput; // 只允许 renderer error 白名单字段
};

export type DesktopRecoveryActions = {
  report_state_error: (error: unknown, args: StateErrorReportArgs) => void;
  refresh_task_after_state_error: (
    reason: string,
    triggering_event: LogErrorContextInput | undefined,
  ) => Promise<void>;
  refresh_project_state_after_error: (
    reason: string,
    triggering_event: LogErrorContextInput | undefined,
    recovery_context?: RendererErrorContextInput,
  ) => Promise<void>;
};

type DesktopRecoveryOptions = {
  project_loaded: boolean; // 决定项目恢复是否有权访问后端项目主链路
  project_path: string; // 为空时不尝试项目恢复刷新
  refresh_project_state: () => Promise<void>; // 回到 manifest + 页面 query 主链路
  refresh_batch_translation: () => Promise<BatchTranslationSnapshot>; // 回到后端 task snapshot 主链路
};

type ProjectRecoveryJob = {
  project_path: string; // 去重身份，项目切换后必须允许新恢复独立启动
  promise: Promise<void>; // 代表当前项目唯一恢复流程，调用方共享完成信号
};

/**
 * state 恢复策略集中在这里，Provider 只负责注册事件和写入共享 store。
 */
export function useDesktopRecovery(options: DesktopRecoveryOptions): DesktopRecoveryActions {
  const { project_loaded, project_path, refresh_project_state, refresh_batch_translation } =
    options;
  const project_recovery_ref = useRef<ProjectRecoveryJob | null>(null);
  const task_recovery_ref = useRef<Promise<void> | null>(null);

  const report_state_error = useCallback((error: unknown, args: StateErrorReportArgs): void => {
    capture_renderer_error(error, {
      source: args.source,
      triggeringEvent: args.triggeringEvent,
      context: args.context,
    });
  }, []);

  // 并发恢复共享一个快照请求。
  const refresh_task_after_state_error = useCallback(
    async (reason: string, triggering_event: LogErrorContextInput | undefined): Promise<void> => {
      const current_recovery = task_recovery_ref.current;
      if (current_recovery !== null) {
        await current_recovery;
        return;
      }

      let recovery_promise!: Promise<void>;
      recovery_promise = refresh_batch_translation()
        .then(() => undefined)
        .catch((error: unknown) => {
          report_state_error(error, {
            source: "state-recovery",
            triggeringEvent: triggering_event,
            context: { reason, recovery: "task_snapshot" },
          });
        })
        .finally(() => {
          if (task_recovery_ref.current === recovery_promise) {
            task_recovery_ref.current = null;
          }
        });

      task_recovery_ref.current = recovery_promise;
      await recovery_promise;
    },
    [refresh_batch_translation, report_state_error],
  );

  // 同一 project path 的恢复共享一个 session 初始化流程，请求方可 await 同一完成信号。
  const refresh_project_state_after_error = useCallback(
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
      recovery_promise = refresh_project_state()
        .catch((error: unknown) => {
          report_state_error(error, {
            source: "state-recovery",
            triggeringEvent: triggering_event,
            context: { ...recovery_context, reason, recovery: "project_state" },
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
    [project_loaded, project_path, refresh_project_state, report_state_error],
  );

  return {
    report_state_error,
    refresh_task_after_state_error,
    refresh_project_state_after_error,
  };
}
