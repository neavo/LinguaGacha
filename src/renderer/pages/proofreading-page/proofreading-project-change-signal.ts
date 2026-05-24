import type { ProjectRuntimeChangeSignal } from "@/app/desktop/desktop-runtime-context";
import type {
  ProjectStoreChangeApplyResult,
  ProjectStoreStage,
} from "@/project/store/project-store";
import type { ProjectChangeItemFieldPatch } from "@shared/project/event";

export type ProofreadingProjectChangeSignal = {
  seq: number;
  reason: string;
  mode: "full" | "delta" | "noop";
  updated_sections: ProjectStoreStage[];
  item_ids: Array<number | string>;
  field_patch: ProjectChangeItemFieldPatch | null;
};

// normalize_proofreading_item_id 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_proofreading_item_id(value: number | string): number | null {
  const item_id = Number(value);
  return Number.isInteger(item_id) && item_id > 0 ? item_id : null;
}

// collect_proofreading_item_ids 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function collect_proofreading_item_ids(
  result: ProjectStoreChangeApplyResult,
): Array<number | string> {
  return [
    ...new Set(
      [...(result.itemDelta?.upsertItemIds ?? []), ...(result.itemDelta?.deleteItemIds ?? [])]
        .map(normalize_proofreading_item_id)
        .filter((item_id): item_id is number => item_id !== null),
    ),
  ];
}

// clone_field_patch 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function clone_field_patch(
  patch: ProjectChangeItemFieldPatch | null | undefined,
): ProjectChangeItemFieldPatch | null {
  if (patch === undefined || patch === null) {
    return null;
  }
  return {
    ...(patch.dst === undefined ? {} : { dst: patch.dst }),
    ...(patch.status === undefined ? {} : { status: patch.status }),
    ...(patch.retry_count === undefined ? {} : { retry_count: patch.retry_count }),
  };
}

// are_field_patches_equal 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function are_field_patches_equal(
  left: ProjectChangeItemFieldPatch,
  right: ProjectChangeItemFieldPatch,
): boolean {
  return (
    left.dst === right.dst && left.status === right.status && left.retry_count === right.retry_count
  );
}

// resolve_single_proofreading_signal 集中解析运行时决策，避免调用点复制条件判断。
function resolve_single_proofreading_signal(
  signal: ProjectRuntimeChangeSignal,
  result: ProjectStoreChangeApplyResult,
): ProofreadingProjectChangeSignal | null {
  const updated_sections = result.updatedSections;
  const has_proofreading_section = updated_sections.includes("proofreading");
  if (
    updated_sections.includes("project") ||
    updated_sections.includes("quality") ||
    result.itemDelta?.fullReplace === true
  ) {
    return {
      seq: signal.seq,
      reason: signal.reason,
      mode: "full",
      updated_sections,
      item_ids: [],
      field_patch: null,
    };
  }

  if (updated_sections.every((section) => section === "proofreading")) {
    return {
      seq: signal.seq,
      reason: signal.reason,
      mode: "noop",
      updated_sections,
      item_ids: [],
      field_patch: null,
    };
  }

  const item_ids = collect_proofreading_item_ids(result);
  const contains_items = updated_sections.includes("items");
  const delta_sections_only = updated_sections.every((section) =>
    ["items", "proofreading"].includes(section),
  );
  if (contains_items && item_ids.length > 0 && delta_sections_only) {
    return {
      seq: signal.seq,
      reason: signal.reason,
      mode: "delta",
      updated_sections,
      item_ids,
      field_patch: clone_field_patch(result.itemDelta?.fieldPatch),
    };
  }

  if (contains_items || has_proofreading_section) {
    return {
      seq: signal.seq,
      reason: signal.reason,
      mode: "full",
      updated_sections,
      item_ids: [],
      field_patch: null,
    };
  }

  return null;
}

// merge_delta_field_patch 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function merge_delta_field_patch(
  signals: readonly ProofreadingProjectChangeSignal[],
): ProjectChangeItemFieldPatch | null {
  const delta_signals = signals.filter((signal) => signal.mode === "delta");
  let field_patch: ProjectChangeItemFieldPatch | null = null;
  for (const signal of delta_signals) {
    if (signal.field_patch === null) {
      return null;
    }
    if (field_patch === null) {
      field_patch = clone_field_patch(signal.field_patch);
      continue;
    }
    if (!are_field_patches_equal(field_patch, signal.field_patch)) {
      return null;
    }
  }
  return field_patch;
}

/**
 * 校对页从 ProjectStore 应用结果派生 worker 同步信号，保持页面缓存策略由页面拥有。
 */
export function resolve_proofreading_project_change_signal(
  signal: ProjectRuntimeChangeSignal,
): ProofreadingProjectChangeSignal | null {
  const signals = signal.results
    .map((result) => resolve_single_proofreading_signal(signal, result))
    .filter((result): result is ProofreadingProjectChangeSignal => result !== null);
  if (signals.length === 0) {
    return null;
  }

  const mode: ProofreadingProjectChangeSignal["mode"] = signals.some((item) => item.mode === "full")
    ? "full"
    : signals.some((item) => item.mode === "delta")
      ? "delta"
      : "noop";
  return {
    seq: signal.seq,
    reason: signal.reason,
    mode,
    updated_sections: [...signal.updated_sections],
    item_ids: mode === "delta" ? [...new Set(signals.flatMap((item) => item.item_ids))] : [],
    field_patch: mode === "delta" ? merge_delta_field_patch(signals) : null,
  };
}
