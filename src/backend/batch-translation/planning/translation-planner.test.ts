import { describe, expect, it, vi } from "vitest";

import type { MutableJsonRecord } from "../../../domain/json";
import { TranslationPlanner } from "./translation-planner";
import type { TranslationTokenCountInput } from "./token-metric-cache";
import type { TranslationContext } from "./translation-plan-types";

describe("TranslationPlanner", () => {
  it("翻译规划按文本 cache key 去重，并在下一次规划复用进程内 token 指标", async () => {
    const count_items = vi.fn(async (items: TranslationTokenCountInput[]) =>
      items.map((item) => ({ cache_key: item.cache_key, token_count: 1 })),
    );
    const planner = create_planner(count_items);
    const items = [
      create_item({ id: 1, src: "重复句。", file_path: "a.txt" }),
      create_item({ id: 2, src: "重复句。", file_path: "a.txt" }),
    ];

    const first_contexts = await planner.build_translation_contexts(
      items,
      { preceding_lines_threshold: 0 },
      { threshold: { input_token_limit: 20 } },
      new AbortController().signal,
    );
    const second_contexts = await planner.build_translation_contexts(
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
    const planner = create_planner(async (items) =>
      items.map((item) => ({ cache_key: item.cache_key, token_count: 12 })),
    );
    const items = [
      create_item({ id: 1, src: "前一句。", file_path: "chapter.txt" }),
      create_item({ id: 2, src: "第二句。", file_path: "chapter.txt" }),
    ];

    const contexts = await planner.build_translation_contexts(
      items,
      { preceding_lines_threshold: 2 },
      { threshold: { input_token_limit: 6 } },
      new AbortController().signal,
    );

    expect(contexts.map((context) => context.items.map((item) => item["id"]))).toEqual([[1], [2]]);
    expect(contexts[0]?.precedings).toEqual([]);
    expect(contexts[1]?.precedings.map((item) => item["id"])).toEqual([1]);
  });

  it("SakuraLLM 每个 work unit 只携带一个 item", async () => {
    const planner = create_planner(async (items) =>
      items.map((item) => ({ cache_key: item.cache_key, token_count: 1 })),
    );
    const items = [
      create_item({ id: 1, src: "第一句。", file_path: "chapter.txt" }),
      create_item({ id: 2, src: "第二句。", file_path: "chapter.txt" }),
    ];

    const contexts = await planner.build_translation_contexts(
      items,
      { preceding_lines_threshold: 2 },
      { api_format: "SakuraLLM", threshold: { input_token_limit: 20 } },
      new AbortController().signal,
    );

    expect(contexts.map((context) => context.items.map((item) => item["id"]))).toEqual([[1], [2]]);
    expect(contexts.every((context) => context.precedings.length === 0)).toBe(true);
  });

  it("翻译规划按短引用投影计算 token 指标", async () => {
    const count_items = vi.fn(async (items: TranslationTokenCountInput[]) =>
      items.map((item) => ({ cache_key: item.cache_key, token_count: 1 })),
    );
    const planner = create_planner(count_items);

    await planner.build_translation_contexts(
      [create_item({ id: 1, src: "查看 data:image/png;base64,AAAA", file_path: "a.txt" })],
      { preceding_lines_threshold: 0 },
      { threshold: { input_token_limit: 20 } },
      new AbortController().signal,
    );

    expect(count_items.mock.calls[0]?.[0]?.[0]?.text).toBe("查看 lg-uri/0");
  });

  it("翻译条目重试超过限制时由调用方标记错误并返回 forced_error_items", async () => {
    const planner = create_planner(async (items) =>
      items.map((item) => ({ cache_key: item.cache_key, token_count: 1 })),
    );
    const failed_item = create_item({ id: 1, src: "失败句", status: "NONE" });
    const context: TranslationContext = {
      work_unit_id: "context-1",
      items: [failed_item],
      precedings: [],
      token_threshold: 20,
      split_count: 0,
      retry_count: 3,
      is_initial: false,
    };

    const plan = await planner.build_translation_retry_plan(
      context,
      [failed_item],
      3,
      (item) => {
        item["status"] = "ERROR";
      },
      new AbortController().signal,
    );

    expect(plan.retry_contexts).toEqual([]);
    expect(plan.forced_error_items).toEqual([failed_item]);
    expect(failed_item["status"]).toBe("ERROR");
  });

  function create_planner(
    count_items: (
      items: TranslationTokenCountInput[],
      signal: AbortSignal,
    ) => Promise<Array<{ cache_key: string; token_count: number }>>,
  ): TranslationPlanner {
    return new TranslationPlanner({
      planningWorkerPool: {
        count_items,
      } as unknown as ConstructorParameters<typeof TranslationPlanner>[0]["planningWorkerPool"],
    });
  }

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
