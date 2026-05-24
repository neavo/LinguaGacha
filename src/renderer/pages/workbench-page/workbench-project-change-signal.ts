import type { ProjectRuntimeChangeSignal } from "@/app/desktop/desktop-runtime-context";
import type {
  ProjectStoreChangeApplyResult,
  ProjectStoreStage,
} from "@/project/store/project-store";

export type WorkbenchProjectChangeSignal = {
  seq: number;
  reason: string;
  mode: "full" | "items_delta";
  updated_sections: ProjectStoreStage[];
  item_ids: Array<number | string>;
};

// WORKBENCH REFRESH SECTIONS 是模块级稳定契约，集中维护避免调用点散落魔术值。
const WORKBENCH_REFRESH_SECTIONS: readonly ProjectStoreStage[] = [
  "project",
  "files",
  "items",
  "analysis",
];

// normalize_workbench_item_id 在边界处归一化输入，避免下游再处理坏载荷分支。
function normalize_workbench_item_id(value: number | string): number | null {
  const item_id = Number(value);
  return Number.isInteger(item_id) && item_id > 0 ? item_id : null;
}

// collect_workbench_item_ids 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function collect_workbench_item_ids(result: ProjectStoreChangeApplyResult): Array<number | string> {
  return [
    ...new Set(
      [...(result.itemDelta?.upsertItemIds ?? []), ...(result.itemDelta?.deleteItemIds ?? [])]
        .map(normalize_workbench_item_id)
        .filter((item_id): item_id is number => item_id !== null),
    ),
  ];
}

// is_workbench_items_delta 集中表达布尔判定口径，避免调用方按局部字段猜测。
function is_workbench_items_delta(result: ProjectStoreChangeApplyResult): boolean {
  return (
    result.updatedSections.includes("items") &&
    result.updatedSections.every((section) => ["items", "proofreading"].includes(section)) &&
    result.itemDelta !== undefined &&
    !result.itemDelta.fullReplace &&
    collect_workbench_item_ids(result).length > 0
  );
}

// result_requires_workbench_refresh 封装当前模块的共享逻辑，避免重复实现同一维护规则。
function result_requires_workbench_refresh(result: ProjectStoreChangeApplyResult): boolean {
  return result.updatedSections.some((section) => WORKBENCH_REFRESH_SECTIONS.includes(section));
}

/**
 * 工作台页面从 ProjectStore 标准应用结果派生缓存刷新信号，desktop runtime 不再登记页面规则。
 */
export function resolve_workbench_project_change_signal(
  signal: ProjectRuntimeChangeSignal,
): WorkbenchProjectChangeSignal | null {
  const workbench_results = signal.results.filter(result_requires_workbench_refresh);
  if (workbench_results.length === 0) {
    return null;
  }

  const all_results_are_item_delta = workbench_results.every(is_workbench_items_delta);
  return {
    seq: signal.seq,
    reason: signal.reason,
    mode: all_results_are_item_delta ? "items_delta" : "full",
    updated_sections: [...signal.updated_sections],
    item_ids: all_results_are_item_delta
      ? [...new Set(workbench_results.flatMap(collect_workbench_item_ids))]
      : [],
  };
}
