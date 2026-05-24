import { useCallback } from "react";

import {
  is_project_change_record,
  normalize_project_change_event,
} from "@/app/desktop/desktop-project-change-normalizer";
import { summarize_project_change_for_diagnostics } from "@/app/desktop/desktop-runtime-diagnostics";
import type { DesktopRuntimeRecoveryActions } from "@/app/desktop/desktop-runtime-recovery";
import type { ProjectStoreChangeEvent } from "@/project/store/project-store";
import {
  InternalInvariantError,
  type ErrorDiagnosticContextInput,
  type RendererErrorContextInput,
} from "@shared/error";
import type { TaskType } from "@shared/task";

export type ProjectMutationResultPayload = {
  accepted?: unknown;
  changes?: unknown;
  failed_files?: unknown;
};

export type ProjectMutationResult = {
  accepted: true;
  changes: ProjectStoreChangeEvent[];
};

type ProjectMutationCommitPhase = "request" | "normalize" | "prepare" | "apply";

// operation 是页面领域拥有的稳定诊断名；desktop runtime 只透传，不登记页面业务词表。
export type ProjectMutationOperation = string;

export type ProjectMutationCommitRequest<
  TPayload extends ProjectMutationResultPayload = ProjectMutationResultPayload,
> = {
  operation: ProjectMutationOperation; // operation 是页面业务意图到诊断语义的显式词表
  task_type?: TaskType; // task_type 仅用于任务相关 mutation 的诊断归因
  run: () => Promise<TPayload>; // run 只提交后端 mutation，运行态负责归一化和回灌
  prepare?: (args: {
    payload: TPayload;
    mutation_result: ProjectMutationResult;
  }) => void | Promise<void>; // prepare 在回灌前登记页面派生状态，避免依赖 React 调度竞态
};

export type ProjectMutationCommitResult<
  TPayload extends ProjectMutationResultPayload = ProjectMutationResultPayload,
> = {
  payload: TPayload; // payload 保留后端原始响应，供导入流程读取 failed_files 等扩展字段
  mutation_result: ProjectMutationResult; // mutation_result 是已经进入 ProjectStore 管线的 canonical changes
};

export type ProjectMutationCommitter = <
  TPayload extends ProjectMutationResultPayload = ProjectMutationResultPayload,
>(
  request: ProjectMutationCommitRequest<TPayload>,
) => Promise<ProjectMutationCommitResult<TPayload>>;

type ProjectMutationCommitterOptions = {
  applyProjectMutationChanges: (result: ProjectMutationResult) => Promise<void>;
  recovery: Pick<
    DesktopRuntimeRecoveryActions,
    "report_runtime_error" | "refresh_project_runtime_after_error"
  >;
};

/**
 * 同步 mutation 只能返回后端 canonical changes，任何坏载荷都暴露为运行态协议错误。
 */
export function normalize_project_mutation_result(
  payload: ProjectMutationResultPayload,
): ProjectMutationResult {
  if (payload.accepted !== true || !Array.isArray(payload.changes)) {
    throw new InternalInvariantError({
      diagnostic_context: { reason: "invalid_project_mutation_result_payload" },
    });
  }

  return {
    accepted: true,
    // mutation result 是同步 HTTP 的 canonical 事实入口；任何无法规范化的 change 都暴露为协议错误。
    changes: payload.changes.map((change, index) =>
      normalize_project_mutation_change_event(change, index),
    ),
  };
}

/**
 * 项目 mutation 的唯一前端入口，集中处理提交、规范化、回灌、诊断和失败恢复。
 */
export function useProjectMutationCommitter(
  options: ProjectMutationCommitterOptions,
): ProjectMutationCommitter {
  const { applyProjectMutationChanges, recovery } = options;
  const { report_runtime_error, refresh_project_runtime_after_error } = recovery;
  return useCallback<ProjectMutationCommitter>(
    async (request) => {
      let phase: ProjectMutationCommitPhase = "request";
      let mutation_result: ProjectMutationResult | null = null;

      try {
        const payload = await request.run();
        phase = "normalize";
        mutation_result = normalize_project_mutation_result(payload);
        if (request.prepare !== undefined) {
          phase = "prepare";
          await request.prepare({ payload, mutation_result });
        }
        phase = "apply";
        await applyProjectMutationChanges(mutation_result);
        return {
          payload,
          mutation_result,
        };
      } catch (error) {
        const triggering_event = summarize_project_mutation_trigger_for_diagnostics(
          request.operation,
          mutation_result,
        );
        const recovery_context = build_project_mutation_recovery_context(request, phase);
        report_runtime_error(error, {
          source: "project-mutation",
          triggeringEvent: triggering_event,
          context: recovery_context,
        });
        await refresh_project_runtime_after_error(
          "project_mutation_failed",
          triggering_event,
          recovery_context,
        );
        throw error;
      }
    },
    [applyProjectMutationChanges, refresh_project_runtime_after_error, report_runtime_error],
  );
}

// normalize_project_mutation_change_event 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_project_mutation_change_event(
  change: unknown,
  index: number,
): ProjectStoreChangeEvent {
  if (!is_project_change_record(change)) {
    throw new InternalInvariantError({
      diagnostic_context: {
        reason: "invalid_project_mutation_change_record",
        index,
      },
    });
  }

  const normalized_change = normalize_project_change_event(change);
  if (normalized_change === null) {
    throw new InternalInvariantError({
      diagnostic_context: {
        reason: "invalid_project_mutation_change_payload",
        index,
      },
    });
  }
  return normalized_change;
}

// mutation 失败诊断只记录业务操作与变更摘要，避免页面层传入完整业务 payload。
function summarize_project_mutation_trigger_for_diagnostics(
  operation: ProjectMutationOperation,
  mutation_result: ProjectMutationResult | null,
): ErrorDiagnosticContextInput {
  if (mutation_result === null) {
    return {
      operation,
    };
  }

  if (mutation_result.changes.length === 1) {
    return {
      operation,
      change: summarize_project_change_for_diagnostics(mutation_result.changes[0]!),
    };
  }

  return {
    operation,
    changeCount: mutation_result.changes.length,
    projectChanges: mutation_result.changes.map(summarize_project_change_for_diagnostics),
  };
}

// recovery context 描述统一管线的失败阶段，页面只提供业务操作名和轻量补充上下文。
function build_project_mutation_recovery_context(
  request: {
    operation: ProjectMutationOperation;
    task_type?: TaskType;
  },
  phase: ProjectMutationCommitPhase,
): RendererErrorContextInput {
  const recovery_context: RendererErrorContextInput = {
    stage: "commit_project_mutation",
    operation: request.operation,
    phase,
  };
  if (request.task_type !== undefined) {
    recovery_context.taskType = request.task_type;
  }
  return recovery_context;
}
