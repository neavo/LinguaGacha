import { describe, expect, it, vi } from "vitest";

import type { MutableJsonRecord } from "../../../domain/json";
import { TranslationPlanner } from "./translation-planner";

describe("TranslationPlanner", () => {
  it("翻译规划按文本 cache key 去重，并在下一次规划复用进程内 token 指标", async () => {
    const count_items = vi.fn(async (items: readonly string[]) => items.map(() => 1));
    const planner = create_planner(count_items);
    const items = [
      create_item({ id: 1, src: "重复句。", file_path: "a.txt" }),
      create_item({ id: 2, src: "重复句。", file_path: "a.txt" }),
    ];

    const first_contexts = await planner.build_translation_plan(
      items,
      { preceding_lines_threshold: 0 },
      { threshold: { input_token_limit: 20 } },
      new AbortController().signal,
    );
    const second_contexts = await planner.build_translation_plan(
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

  it("翻译切块在 token 阈值处拆分，并为后续块保留同文件句末前文", async () => {
    const planner = create_planner(async (items) => items.map(() => 12));
    const items = [
      create_item({ id: 1, src: "前一句。", file_path: "chapter.txt" }),
      create_item({ id: 2, src: "第二句。", file_path: "chapter.txt" }),
    ];

    const contexts = await planner.build_translation_plan(
      items,
      { preceding_lines_threshold: 2, following_lines_threshold: 2 },
      { threshold: { input_token_limit: 6 } },
      new AbortController().signal,
    );

    expect(contexts.map((context) => context.items.map((item) => item["id"]))).toEqual([[1], [2]]);
    expect(contexts[0]?.precedings).toEqual([]);
    expect(contexts[0]?.followings.map((item) => item.id)).toEqual([2]);
    expect(contexts[1]?.followings).toEqual([]);
    expect(contexts[1]?.precedings.map((item) => item["id"])).toEqual([1]);
  });

  it("指定目标保留范围外前文，前文不进入实际翻译集合", async () => {
    const planner = create_planner(async (items) => items.map(() => 1));
    const items = [1, 2, 3, 4].map((id) =>
      create_item({ id, src: `第${id}句。`, file_path: "chapter.txt" }),
    );
    const contexts = await planner.build_translation_plan(
      items,
      { preceding_lines_threshold: 2, following_lines_threshold: 2 },
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

    const contexts = await planner.build_translation_plan(
      items,
      { preceding_lines_threshold: 2, following_lines_threshold: 2 },
      { api_format: "SakuraLLM", threshold: { input_token_limit: 20 } },
      new AbortController().signal,
    );

    expect(contexts.map((context) => context.items.map((item) => item["id"]))).toEqual([
      [1, 2],
      [3],
      [4],
    ]);
    expect(
      contexts.every(
        (context) => context.precedings.length === 0 && context.followings.length === 0,
      ),
    ).toBe(true);
  });

  it("仅姓名任务按姓名容量分批", async () => {
    const count_items = vi.fn(async (texts: readonly string[]) => texts.map(() => 12));
    const planner = create_planner(count_items);
    const plan = await planner.build_translation_plan(
      [
        create_item({ id: 1, src: "", name_src: "虎鉄" }),
        create_item({ id: 2, src: "", name_src: "美咲" }),
      ],
      {},
      { api_format: "SakuraLLM", threshold: { input_token_limit: 16 } },
      new AbortController().signal,
    );
    expect(count_items.mock.calls[0]?.[0]).toEqual([
      expect.stringContaining("虎鉄"),
      expect.stringContaining("美咲"),
    ]);
    expect(count_items.mock.calls[0]?.[0]?.[0]).not.toContain("格式元数据");
    expect(plan.map((context) => context.items.map((item) => item.id))).toEqual([[1], [2]]);
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

  it("行数忽略空行，源文修改后重新计算切块容量", async () => {
    const count_items = vi.fn(async (texts: readonly string[]) => texts.map(() => 1));
    const planner = create_planner(count_items);
    const signal = new AbortController().signal;
    const items = [
      create_item({ src: "第一行\n \n第二行" }),
      create_item({ id: 2, src: "三\n四\n五\n六\n七\n八" }),
    ];
    const model = { threshold: { input_token_limit: 16 } };
    const first = await planner.build_translation_plan(items, {}, model, signal);
    expect(first.map((context) => context.items.map((item) => item.id))).toEqual([[1, 2]]);
    const second = await planner.build_translation_plan(
      [{ ...items[0], src: "第一行\n第二行\n新增行" }, items[1]!],
      {},
      model,
      signal,
    );
    expect(second.map((context) => context.items.map((item) => item.id))).toEqual([[1], [2]]);
  });

  it("不连续目标按真实首尾索引选取上下文，多行条目计为一条", async () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      create_item({ id: i + 1, src: `${i + 1}。\n末行。` }),
    );
    const contexts = await create_planner(async (texts) =>
      texts.map(() => 6),
    ).build_translation_plan(
      items,
      { preceding_lines_threshold: 2, following_lines_threshold: 2 },
      { threshold: { input_token_limit: 16 } },
      new AbortController().signal,
      new Set([3, 5, 8]),
    );
    expect(
      contexts.map(({ items, precedings, followings }) => ({
        items: items.map((item) => item.id),
        precedings: precedings.map((item) => item.id),
        followings: followings.map((item) => item.id),
      })),
    ).toEqual([
      { items: [3, 5], precedings: [1, 2], followings: [6, 7] },
      { items: [8], precedings: [6, 7], followings: [9] },
    ]);
    const disabled = await create_planner(async (texts) =>
      texts.map(() => 1),
    ).build_translation_plan(items, {}, {}, new AbortController().signal, new Set([3]));
    expect(disabled[0]).toMatchObject({ precedings: [], followings: [] });
  });

  describe.each(["precedings", "followings"] as const)("%s 边界", (direction) => {
    it.each([
      { name: "空文本", barrier: { src: " " }, expected: [2] },
      { name: "非句末", barrier: { src: "未完" }, expected: [2] },
      { name: "异文件", barrier: { file_path: "other.txt" }, expected: [2] },
      {
        name: "跳过异文件",
        barrier: { file_path: "other.txt", status: "EXCLUDED" },
        expected: [2],
      },
      ...["EXCLUDED", "RULE_SKIPPED", "LANGUAGE_SKIPPED", "DUPLICATED"].map((status) => ({
        name: status,
        barrier: { status, src: "" },
        expected: [2, 4],
      })),
    ])("$name", async ({ barrier, expected }) => {
      const items = [
        create_item({ id: 1, src: "目标。" }),
        create_item({ id: 2, src: "近文。" }),
        create_item({ id: 3, src: "边界。", ...barrier }),
        create_item({ id: 4, src: "远文。" }),
      ];
      if (direction === "precedings") items.reverse();
      const contexts = await create_planner(async (texts) =>
        texts.map(() => 1),
      ).build_translation_plan(
        items,
        { preceding_lines_threshold: 2, following_lines_threshold: 2 },
        {},
        new AbortController().signal,
        new Set([1]),
      );
      expect(contexts[0]?.[direction].map((item) => item.id)).toEqual(
        direction === "precedings" ? [...expected].reverse() : expected,
      );
    });

    it("长上下文扫描响应取消", async () => {
      const controller = new AbortController();
      const items = Array.from({ length: 3000 }, (_, i) =>
        create_item({ id: i + 1, src: "文。", status: i === 0 ? "NONE" : "PROCESSED" }),
      );
      if (direction === "precedings") items.reverse();
      const planner = create_planner(async (texts) => {
        setImmediate(() => controller.abort(new Error("cancel context")));
        return texts.map(() => 1);
      });
      await expect(
        planner.build_translation_plan(
          items,
          { preceding_lines_threshold: 9999, following_lines_threshold: 9999 },
          {},
          controller.signal,
          new Set([1]),
        ),
      ).rejects.toThrow("cancel context");
    });
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
