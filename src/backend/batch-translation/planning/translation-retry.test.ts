import { describe, expect, it } from "vitest";
import type { TranslationContext } from "./translation-plan-types";
import { plan_translation_retry } from "./translation-retry";

/** 保留源文与上文快照，验证重试阶段的载荷选择。 */
function create_context(retry_count: number, ids: number[]): TranslationContext {
  return {
    work_unit_id: "original",
    items: ids.map((id) => ({ id, src: `原文${id}`, status: "NONE" })),
    precedings: [{ id: 9, src: "上文" }],
    retry_count,
  };
}

describe("plan_translation_retry", () => {
  it("对半切只重试失败条目，保留本轮源文与顺序并去掉上文", () => {
    const context = create_context(0, [1, 2, 3, 4, 5]);
    const returned = context.items.toReversed().map((item) => ({
      ...item,
      src: "worker 源文",
      status: item.id === 2 ? "PROCESSED" : "NONE",
    }));
    const result = plan_translation_retry(context, returned);
    expect(result.error_items).toEqual([]);
    expect(result.retry_contexts).toMatchObject([
      { items: [context.items[0], context.items[2]], precedings: [], retry_count: 1 },
      { items: [context.items[3], context.items[4]], precedings: [], retry_count: 1 },
    ]);
  });

  it("多条单元对半切两轮后拆成单条，单条重新开始计数", () => {
    let contexts = [
      create_context(
        0,
        Array.from({ length: 12 }, (_, index) => index + 1),
      ),
    ];
    for (const sizes of [[6, 6], [3, 3, 3, 3], Array(12).fill(1)]) {
      contexts = contexts.flatMap(
        (context) => plan_translation_retry(context, context.items).retry_contexts,
      );
      expect(contexts.map((context) => context.items.length)).toEqual(sizes);
    }
    expect(contexts.every((context) => context.retry_count === 0)).toBe(true);
  });

  it("单条执行两次仍失败时，在 worker 快照上标记 ERROR", () => {
    const context = create_context(2, [1, 2]);
    const [single] = plan_translation_retry(context, [
      { ...context.items[0], status: "PROCESSED" },
      context.items[1]!,
    ]).retry_contexts;
    expect(single).toMatchObject({ items: [context.items[1]], retry_count: 0 });
    const [retry] = plan_translation_retry(single!, single!.items).retry_contexts;
    expect(retry?.retry_count).toBe(1);
    const returned = [{ id: 2, src: "worker 源文", status: "NONE", dst: "" }];
    const final = plan_translation_retry(retry!, returned);
    expect(final.retry_contexts).toEqual([]);
    expect(final.error_items[0]).toBe(returned[0]);
    expect(returned[0]?.status).toBe("ERROR");
    expect(context.items[1]?.status).toBe("NONE");
  });
});
