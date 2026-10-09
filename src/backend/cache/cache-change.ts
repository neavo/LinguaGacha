import type { ProjectCommittedChange } from "../project/project-committed-change";

/** 结构性修改全量替换，局部写入只携带规范行。 */
export type CacheItemChange =
  | { mode: "keep" }
  | { mode: "full" }
  | { mode: "delta"; changedIds: number[] };

/** 视图缓存只消费本次提交的失效范围。 */
export type CacheBlockChange = { mode: "keep" } | { mode: "full" };

/** 视图更新所需的工程身份、来源与受影响分区。 */
export type CacheChange = {
  projectPath: string;
  source: string;
  items: CacheItemChange;
  quality: CacheBlockChange;
  settings: CacheBlockChange;
};

/** 提交结果已经校验并持久化，缓存无需再次解释外部补丁。 */
export function create_cache_change(
  change: Pick<ProjectCommittedChange, "projectPath" | "source" | "updatedSections" | "items">,
): CacheChange {
  return {
    projectPath: change.projectPath,
    source: change.source,
    items:
      change.items?.payloadMode === "canonical-delta"
        ? { mode: "delta", changedIds: change.items.changedIds }
        : { mode: change.updatedSections.includes("items") ? "full" : "keep" },
    quality: { mode: change.updatedSections.includes("quality") ? "full" : "keep" },
    settings: { mode: change.updatedSections.includes("project") ? "full" : "keep" },
  };
}
