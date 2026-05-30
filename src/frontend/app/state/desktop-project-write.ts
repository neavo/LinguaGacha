import { useCallback } from "react";

import {
  is_project_change_record,
  normalize_project_change_event,
} from "@frontend/app/state/desktop-project-change-normalizer";
import type { ProjectChangeEventForState } from "@frontend/app/state/desktop-project-change-types";
import { summarize_project_change_for_diagnostics } from "@frontend/app/state/desktop-diagnostics";
import type { DesktopRecoveryActions } from "@frontend/app/state/desktop-recovery";
import {
  InternalInvariantError,
  type LogErrorContextInput,
  type RendererErrorContextInput,
} from "@shared/error";
import type { TaskType } from "@domain/task";

export type ProjectWriteResultPayload = {
  accepted?: unknown;
  changes?: unknown;
  failed_files?: unknown;
};

export type ProjectWriteResult = {
  accepted: true;
  changes: ProjectChangeEventForState[];
};

type ProjectWriteCommitPhase = "request" | "normalize" | "prepare" | "apply";

// operation 是页面领域拥有的稳定诊断名；desktop state 只透传，不登记页面业务词表。
export type ProjectWriteOperation = string;

export type ProjectWriteCommitRequest<
  TPayload extends ProjectWriteResultPayload = ProjectWriteResultPayload,
> = {
  operation: ProjectWriteOperation; // operation 是页面业务意图到诊断语义的显式词表
  task_type?: TaskType; // task_type 仅用于任务相关写入的诊断归因
  run: () => Promise<TPayload>; // run 只提交后端写入，运行态负责归一化和回灌
  prepare?: (args: { payload: TPayload; write_result: ProjectWriteResult }) => void | Promise<void>; // prepare 在回灌前登记页面计算状态，避免依赖 React 调度竞态
};

export type ProjectWriteCommitResult<
  TPayload extends ProjectWriteResultPayload = ProjectWriteResultPayload,
> = {
  payload: TPayload; // payload 保留后端原始响应，供导入流程读取 failed_files 等扩展字段
  write_result: ProjectWriteResult; // write_result 是已经进入项目事件管线的规范化 changes
};

export type ProjectWriteCommitter = <
  TPayload extends ProjectWriteResultPayload = ProjectWriteResultPayload,
>(
  request: ProjectWriteCommitRequest<TPayload>,
) => Promise<ProjectWriteCommitResult<TPayload>>;

type ProjectWriteCommitterOptions = {
  applyProjectWriteChanges: (result: ProjectWriteResult) => Promise<void>;
  recovery: Pick<
    DesktopRecoveryActions,
    "report_state_error" | "refresh_project_state_after_error"
  >;
};

/**
 * 同步写入只能返回后端规范化 changes，任何坏载荷都暴露为运行态协议错误。
 */
export function normalize_project_write_result(
  payload: ProjectWriteResultPayload,
): ProjectWriteResult {
  if (payload.accepted !== true || !Array.isArray(payload.changes)) {
    throw new InternalInvariantError({
      diagnostic_context: { reason: "invalid_project_write_result_payload" },
    });
  }

  return {
    accepted: true,
    // 写入结果是同步 HTTP 的规范化事实入口；任何无法规范化的 change 都暴露为协议错误。
    changes: payload.changes.map((change, index) =>
      normalize_project_write_change_event(change, index),
    ),
  };
}

/**
 * 项目写入的唯一前端入口，集中处理提交、规范化、回灌、诊断和失败恢复。
 */
export function useProjectWriteCommitter(
  options: ProjectWriteCommitterOptions,
): ProjectWriteCommitter {
  const { applyProjectWriteChanges, recovery } = options;
  const { report_state_error, refresh_project_state_after_error } = recovery;
  return useCallback<ProjectWriteCommitter>(
    async (request) => {
      let phase: ProjectWriteCommitPhase = "request";
      let write_result: ProjectWriteResult | null = null;

      try {
        const payload = await request.run();
        phase = "normalize";
        write_result = normalize_project_write_result(payload);
        if (request.prepare !== undefined) {
          phase = "prepare";
          await request.prepare({ payload, write_result });
        }
        phase = "apply";
        await applyProjectWriteChanges(write_result);
        return {
          payload,
          write_result,
        };
      } catch (error) {
        const triggering_event = summarize_project_write_trigger_for_diagnostics(
          request.operation,
          write_result,
        );
        const recovery_context = build_project_write_recovery_context(request, phase);
        report_state_error(error, {
          source: "project-write",
          triggeringEvent: triggering_event,
          context: recovery_context,
        });
        await refresh_project_state_after_error(
          "project_write_failed",
          triggering_event,
          recovery_context,
        );
        throw error;
      }
    },
    [applyProjectWriteChanges, refresh_project_state_after_error, report_state_error],
  );
}

// normalize_project_write_change_event 在边界处归一化输入，避免下游再处理坏载荷分支。
/**
 * 归一化输入，保证下游消费稳定形状。
 */
function normalize_project_write_change_event(
  change: unknown,
  index: number,
): ProjectChangeEventForState {
  if (!is_project_change_record(change)) {
    throw new InternalInvariantError({
      diagnostic_context: {
        reason: "invalid_project_write_change_record",
        index,
      },
    });
  }

  const normalized_change = normalize_project_change_event(change);
  if (normalized_change === null) {
    throw new InternalInvariantError({
      diagnostic_context: {
        reason: "invalid_project_write_change_payload",
        index,
      },
    });
  }
  return normalized_change;
}

// 写入失败诊断只记录业务操作与变更摘要，避免页面层传入完整业务 payload。
/**
 * 解析当前场景的最终消费值。
 */
function summarize_project_write_trigger_for_diagnostics(
  operation: ProjectWriteOperation,
  write_result: ProjectWriteResult | null,
): LogErrorContextInput {
  if (write_result === null) {
    return {
      operation,
    };
  }

  if (write_result.changes.length === 1) {
    return {
      operation,
      change: summarize_project_change_for_diagnostics(write_result.changes[0]!),
    };
  }

  return {
    operation,
    changeCount: write_result.changes.length,
    projectChanges: write_result.changes.map(summarize_project_change_for_diagnostics),
  };
}

// recovery context 描述统一管线的失败阶段，页面只提供业务操作名和轻量补充上下文。
/**
 * 构建当前场景的稳定结果。
 */
function build_project_write_recovery_context(
  request: {
    operation: ProjectWriteOperation;
    task_type?: TaskType;
  },
  phase: ProjectWriteCommitPhase,
): RendererErrorContextInput {
  const recovery_context: RendererErrorContextInput = {
    stage: "commit_project_write",
    operation: request.operation,
    phase,
  };
  if (request.task_type !== undefined) {
    recovery_context.taskType = request.task_type;
  }
  return recovery_context;
}
