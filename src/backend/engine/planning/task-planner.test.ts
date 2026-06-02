import { describe, expect, it, vi } from "vitest";

import type { MutableJsonRecord } from "../run/task-run-types";
import { TaskPlanner } from "./task-planner";
import { TaskTokenMetricCache, type TaskTokenCountInput } from "./token-metric-cache";
import type { TaskItemRecord, TranslationContext } from "./task-plan-types";

describe("TaskPlanner", () => {
  it("翻译规划按文本 cache key 去重，并在下一次规划复用进程内 token 指标", async () => {
    const count_items = vi.fn(async (items: TaskTokenCountInput[]) =>
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

  it("分析规划只调度未完成且可分析的 item，并携带 checkpoint 状态", async () => {
    const count_items = vi.fn(async (items: TaskTokenCountInput[]) =>
      items.map((item) => ({ cache_key: item.cache_key, token_count: 1 })),
    );
    const planner = create_planner(count_items);

    const contexts = await planner.build_analysis_contexts(
      [
        create_item({ id: 1, src: "需要分析", file_path: "a.txt", name_src: ["艾琳"] }),
        create_item({ id: 2, src: "已完成", file_path: "a.txt" }),
        create_item({ id: 3, src: "跳过", file_path: "a.txt", status: "EXCLUDED" }),
        create_item({ id: 4, src: "  ", file_path: "a.txt" }),
      ],
      [
        { item_id: 1, status: "NONE" },
        { item_id: 2, status: "PROCESSED" },
      ],
      { threshold: { input_token_limit: 20 } },
      new AbortController().signal,
    );

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      file_path: "a.txt",
      retry_count: 0,
      items: [
        {
          item_id: 1,
          src_text: "【艾琳】需要分析",
          previous_status: "NONE",
        },
      ],
    });
    expect(count_items.mock.calls[0]?.[0].map((item) => item.text)).toEqual(["【艾琳】需要分析"]);
  });

  it("分析规划按第 0 槽姓名渲染 src_text，并保持空正文跳过", async () => {
    const count_items = vi.fn(async (items: TaskTokenCountInput[]) =>
      items.map((item) => ({ cache_key: item.cache_key, token_count: 1 })),
    );
    const planner = create_planner(count_items);

    const contexts = await planner.build_analysis_contexts(
      [
        create_item({ id: 1, src: "台词一", file_path: "a.txt", name_src: "虎鉄" }),
        create_item({ id: 2, src: "台词二", file_path: "a.txt", name_src: ["虎鉄", "花子"] }),
        create_item({ id: 3, src: "台词三", file_path: "a.txt", name_src: ["", "花子"] }),
        create_item({ id: 4, src: "台词四", file_path: "a.txt", name_src: null }),
        create_item({ id: 5, src: "  ", file_path: "a.txt", name_src: "空正文角色" }),
      ],
      [],
      { threshold: { input_token_limit: 20 } },
      new AbortController().signal,
    );

    const src_texts = contexts.flatMap((context) => context.items.map((item) => item.src_text));
    expect(src_texts).toEqual(["【虎鉄】台词一", "【虎鉄】台词二", "台词三", "台词四"]);
    expect(count_items.mock.calls[0]?.[0].map((item) => item.text)).toEqual(src_texts);
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
      items: TaskTokenCountInput[],
      signal: AbortSignal,
    ) => Promise<Array<{ cache_key: string; token_count: number }>>,
  ): TaskPlanner {
    return new TaskPlanner({
      metricCache: new TaskTokenMetricCache(),
      planningWorkerPool: {
        count_items,
      } as unknown as ConstructorParameters<typeof TaskPlanner>[0]["planningWorkerPool"],
    });
  }

  function create_item(overrides: Partial<MutableJsonRecord>): TaskItemRecord {
    return {
      id: 1,
      src: "",
      file_path: "chapter.txt",
      status: "NONE",
      ...overrides,
    };
  }
});
