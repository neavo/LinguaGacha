import { expect, it, vi } from "vitest";
import {
  canSortQualityRuleStatistics,
  createEmptyQualityRuleStatisticsCacheSnapshot,
  createQualityRuleStatisticsStore,
  isQualityRuleStatisticsCacheReady,
  isQualityRuleStatisticsCacheRunning,
  resolveQualityRuleStatisticsInvalidationScope,
  shouldRequestQualityRuleStatisticsForeground,
  type QualityStatisticsQueryResponse,
} from "./quality-rule-statistics-store";

/** 完成结果只表达规则身份与命中事实。 */
function response(id = "new"): QualityStatisticsQueryResponse {
  return {
    projectPath: "project.lg",
    statistics: { entry_ids: [id], hits_by_entry_id: { [id]: 1 }, subset_parents_by_entry_id: {} },
  };
}
/** 手动控制响应顺序，覆盖迟到结果与失败。 */
function deferred() {
  let resolve!: (value: QualityStatisticsQueryResponse) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<QualityStatisticsQueryResponse>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
/** 排空回包、错误处理与请求清理的 Promise 链。 */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

it("页面仅补算空缓存，失败保留同一工程的有效结果", async () => {
  const query = vi.fn().mockResolvedValue(response());
  const store = createQualityRuleStatisticsStore(query);
  const empty = store.getSnapshot().caches.glossary;
  expect(shouldRequestQualityRuleStatisticsForeground(empty)).toBe(true);
  expect(canSortQualityRuleStatistics(empty)).toBe(false);
  store.reset("project.lg");
  store.refreshRule("glossary");
  expect(isQualityRuleStatisticsCacheRunning(store.getSnapshot().caches.glossary)).toBe(true);
  await settle();
  expect(isQualityRuleStatisticsCacheReady(store.getSnapshot().caches.glossary)).toBe(true);
  query.mockRejectedValueOnce(new Error("failed"));
  store.refreshRule("glossary");
  await settle();
  const failed = store.getSnapshot().caches.glossary;
  expect(failed.phase).toBe("failed");
  expect(failed.last_error?.message).toBe("failed");
  expect(canSortQualityRuleStatistics(failed)).toBe(true);
  expect(shouldRequestQualityRuleStatisticsForeground(failed)).toBe(false);
  store.applyInvalidation("all");
  expect(store.getSnapshot().caches.glossary).toEqual(
    createEmptyQualityRuleStatisticsCacheSnapshot(),
  );
});

it("合并事务提供的统计失效范围", () => {
  expect(resolveQualityRuleStatisticsInvalidationScope([])).toBe("none");
  expect(
    resolveQualityRuleStatisticsInvalidationScope([
      { qualityStatisticsScope: "none" },
      { qualityStatisticsScope: "post_replacement" },
    ]),
  ).toBe("post_replacement");
  expect(
    resolveQualityRuleStatisticsInvalidationScope([
      { qualityStatisticsScope: "post_replacement" },
      { qualityStatisticsScope: "all" },
    ]),
  ).toBe("all");
});

it("仅译后失效保留原文统计，无变化不发布更新", async () => {
  const store = createQualityRuleStatisticsStore(async () => response());
  store.reset("project.lg");
  store.refreshRule("glossary");
  store.refreshRule("post_replacement");
  await settle();
  const listener = vi.fn();
  store.subscribe(listener);
  store.applyInvalidation("none");
  expect(listener).not.toHaveBeenCalled();
  store.applyInvalidation("post_replacement");
  expect(store.getSnapshot().caches.glossary.phase).toBe("current");
  expect(store.getSnapshot().caches.post_replacement.phase).toBe("empty");
});

it.each(["resolve", "reject"] as const)(
  "同路径重载后旧请求 %s 无法覆盖或清理新请求",
  async (outcome) => {
    const old = deferred(),
      next = deferred();
    const query = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const store = createQualityRuleStatisticsStore(query);
    store.reset("project.lg");
    store.refreshRule("glossary");
    store.reset("");
    store.reset("project.lg");
    store.refreshRule("glossary");
    if (outcome === "resolve") old.resolve(response("old"));
    else old.reject(new Error("old failed"));
    await settle();
    expect(store.getSnapshot().caches.glossary).toMatchObject({
      phase: "running",
      entry_ids: null,
      last_error: null,
    });
    next.resolve(response());
    await settle();
    expect(store.getSnapshot().caches.glossary.entry_ids).toEqual(["new"]);
  },
);

it("失效或退出工程后进行中的请求不可发布", async () => {
  const first = deferred(),
    second = deferred();
  const store = createQualityRuleStatisticsStore(
    vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
  );
  store.reset("project.lg");
  store.refreshRule("post_replacement");
  store.applyInvalidation("post_replacement");
  first.resolve(response("old"));
  await settle();
  expect(store.getSnapshot().caches.post_replacement.phase).toBe("empty");
  store.refreshRule("glossary");
  store.reset("");
  second.reject(new Error("old failed"));
  await settle();
  expect(store.getSnapshot().project_path).toBe("");
  expect(store.getSnapshot().caches.glossary.phase).toBe("empty");
});

it("新刷新替换旧请求，旧完成不会删除新请求身份", async () => {
  const first = deferred(),
    second = deferred();
  const store = createQualityRuleStatisticsStore(
    vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
  );
  store.reset("project.lg");
  store.refreshRule("glossary");
  store.refreshRule("glossary");
  first.resolve(response("old"));
  await settle();
  expect(store.getSnapshot().caches.glossary).toMatchObject({ phase: "running", entry_ids: null });
  second.resolve(response());
  await settle();
  expect(store.getSnapshot().caches.glossary.entry_ids).toEqual(["new"]);
});

it("后端回包属于其它工程时不发布结果", async () => {
  const store = createQualityRuleStatisticsStore(async () => ({
    ...response("old"),
    projectPath: "other.lg",
  }));
  store.reset("project.lg");
  store.refreshRule("glossary");
  await settle();
  expect(store.getSnapshot().caches.glossary).toMatchObject({ phase: "running", entry_ids: null });
});
