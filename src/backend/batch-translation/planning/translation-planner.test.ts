import { describe, expect, it, vi } from "vitest";

import type { MutableJsonRecord } from "../../../domain/json";
import { TranslationPlanner } from "./translation-planner";
import type { TranslationContext } from "./translation-plan-types";

describe("TranslationPlanner", () => {
  it("翻译规划按文本 cache key 去重，并在下一次规划复用进程内 token 指标", async () => {
    const count_items = vi.fn(async (items: readonly string[]) => items.map(() => 1));
    const planner = create_planner(count_items);
    const items = [
      create_item({ id: 1, src: "重复句。", file_path: "a.txt" }),
      create_item({ id: 2, src: "重复句。", file_path: "a.txt" }),
    ];

    const { contexts: first_contexts } = await planner.build_translation_plan(
      items,
      { preceding_lines_threshold: 0 },
      { threshold: { input_token_limit: 20 } },
      new AbortController().signal,
    );
    const { contexts: second_contexts } = await planner.build_translation_plan(
      items,
      { preceding_lines_threshold: 0 },
      { threshold: { input_token_limit: 20 } },
      new AbortController().signal,
    );

    expect(first_contexts).toHaveLength(1);
    expect(first_contexts[0]?.items.map((item) => item["id"])).toEqual([1, 2]);
    expect(second_contexts[0]?.items.map((item) => item["id"])).toEqual([1, 2]);
    expect(count_items).toHaveBeenCalledTimes(1);
    expect(count_items.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("翻译切块在 token 阈值处拆分，并为后续块保留同文件句末上文", async () => {
    const planner = create_planner(async (items) => items.map(() => 12));
    const items = [
      create_item({ id: 1, src: "前一句。", file_path: "chapter.txt" }),
      create_item({ id: 2, src: "第二句。", file_path: "chapter.txt" }),
    ];

    const { contexts } = await planner.build_translation_plan(
      items,
      { preceding_lines_threshold: 2 },
      { threshold: { input_token_limit: 6 } },
      new AbortController().signal,
    );

    expect(contexts.map((context) => context.items.map((item) => item["id"]))).toEqual([[1], [2]]);
    expect(contexts[0]?.precedings).toEqual([]);
    expect(contexts[1]?.precedings.map((item) => item["id"])).toEqual([1]);
  });

  it("指定目标保留范围外前文，前文不进入实际翻译集合", async () => {
    const planner = create_planner(async (items) => items.map(() => 1));
    const items = [1, 2, 3, 4].map((id) =>
      create_item({ id, src: `第${id}句。`, file_path: "chapter.txt" }),
    );
    const { contexts } = await planner.build_translation_plan(
      items,
      { preceding_lines_threshold: 2 },
      {},
      new AbortController().signal,
      new Set([3]),
    );
    expect(contexts.flatMap((context) => context.items.map((item) => item["id"]))).toEqual([3]);
    expect(contexts[0]?.precedings.map((item) => item["id"])).toEqual([1, 2]);
  });

  it("SakuraLLM 按容量合批并在文件边界切段", async () => {
    const planner = create_planner(async (items) => items.map(() => 9));
    const items = [
      create_item({ id: 1, src: "第一句。", file_path: "chapter.txt" }),
      create_item({ id: 2, src: "第二句。", file_path: "chapter.txt" }),
      create_item({ id: 3, src: "第三句。", file_path: "chapter.txt" }),
      create_item({ id: 4, src: "第四句。", file_path: "next.txt" }),
    ];

    const { contexts } = await planner.build_translation_plan(
      items,
      { preceding_lines_threshold: 2 },
      { api_format: "SakuraLLM", threshold: { input_token_limit: 20 } },
      new AbortController().signal,
    );

    expect(contexts.map((context) => context.items.map((item) => item["id"]))).toEqual([
      [1, 2],
      [3],
      [4],
    ]);
    expect(contexts.every((context) => context.precedings.length === 0)).toBe(true);
  });

  it("翻译规划按短引用投影计算 token 指标", async () => {
    const count_items = vi.fn(async (items: readonly string[]) => items.map(() => 1));
    const planner = create_planner(count_items);

    await planner.build_translation_plan(
      [create_item({ id: 1, src: "查看 data:image/png;base64,AAAA", file_path: "a.txt" })],
      { preceding_lines_threshold: 0 },
      { threshold: { input_token_limit: 20 } },
      new AbortController().signal,
    );

    expect(count_items.mock.calls[0]?.[0]?.[0]).toBe("查看 lg-uri/0");
  });

  it("重试只使用给定指标和本轮源文，保持原始顺序", () => {
    const count_items = vi.fn(async () => {
      throw new Error("重试不应重新计数");
    });
    const planner = create_planner(count_items);
    const items = [
      create_item({ id: 1, src: "第一句。" }),
      create_item({ id: 2, src: "第二句。" }),
    ];
    const context: TranslationContext = {
      work_unit_id: "retry",
      items,
      precedings: [],
      token_threshold: 32,
      split_count: 0,
      retry_count: 0,
      is_initial: true,
    };
    const metrics = new Map(
      items.map((item) => [Number(item.id), { token_count: 16, line_count: 1 }]),
    );
    const result = planner.build_translation_retry_plan(
      context,
      items.toReversed().map((item) => ({ ...item, src: "worker 返回的源文" })),
      metrics,
      3,
      () => {},
      new AbortController().signal,
    );
    expect(count_items).not.toHaveBeenCalled();
    expect(result.retry_contexts.map((chunk) => chunk.items)).toEqual([[items[0]], [items[1]]]);
  });

  it("本轮行数来自原文，新的任务重新识别修改后的源文", async () => {
    const count_items = vi.fn(async (texts: readonly string[]) => texts.map(() => 1));
    const planner = create_planner(count_items);
    const signal = new AbortController().signal;
    const first = await planner.build_translation_plan(
      [create_item({ src: "第一行\n \n第二行" })],
      {},
      {},
      signal,
    );
    expect(first.metrics.get(1)).toEqual({ token_count: 1, line_count: 2 });
    await planner.build_translation_plan([create_item({ src: "修改后的源文" })], {}, {}, signal);
    expect(count_items).toHaveBeenCalledTimes(2);
  });

  /** 只替代昂贵的计数传输，缓存和切块使用真实实现。 */
  function create_planner(
    count_items: (items: readonly string[], signal: AbortSignal) => Promise<number[]>,
  ): TranslationPlanner {
    return new TranslationPlanner({
      planningWorkerPool: {
        count_items,
      },
    });
  }

  /** 构造具有稳定数据库身份的源条目。 */
  function create_item(overrides: Partial<MutableJsonRecord>): MutableJsonRecord {
    return {
      id: 1,
      src: "",
      file_path: "chapter.txt",
      status: "NONE",
      ...overrides,
    };
  }
});
