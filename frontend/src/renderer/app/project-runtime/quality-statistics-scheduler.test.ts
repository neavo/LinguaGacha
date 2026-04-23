import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  QualityStatisticsTaskInput,
  QualityStatisticsTaskResult,
} from "@/app/project-runtime/quality-statistics";
import type { ProjectStoreState } from "@/app/project-runtime/project-store";
import {
  REFRESH_DELAY_BY_PRIORITY,
  createQualityStatisticsScheduler,
} from "@/app/project-runtime/quality-statistics-scheduler";
import { createQualityStatisticsStore } from "@/app/project-runtime/quality-statistics-store";
import type { QualityStatisticsTaskExecutor } from "@/app/project-runtime/quality-statistics-worker-pool";

function create_success_result(input: QualityStatisticsTaskInput): QualityStatisticsTaskResult {
  return {
    results: Object.fromEntries(
      input.rules.map((rule) => {
        return [
          rule.key,
          {
            matched_item_count: 1,
            subset_parents: [],
          },
        ];
      }),
    ),
  };
}

function create_deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((resolve_value, reject_value) => {
    resolve = resolve_value;
    reject = reject_value;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function create_test_state(): ProjectStoreState {
  return {
    project: {
      path: "E:/demo/sample.lg",
      loaded: true,
    },
    files: {},
    items: {
      "1": {
        item_id: 1,
        file_path: "chapter01.txt",
        src: "apple hero foo42",
        dst: "banana hero 保留",
      },
    },
    quality: {
      glossary: {
        entries: [
          {
            src: "apple",
            dst: "Apple",
            info: "fruit",
            case_sensitive: false,
          },
        ],
        enabled: true,
        mode: "custom",
        revision: 1,
      },
      pre_replacement: {
        entries: [
          {
            src: "hero",
            dst: "勇者",
            regex: false,
            case_sensitive: false,
          },
        ],
        enabled: true,
        mode: "custom",
        revision: 1,
      },
      post_replacement: {
        entries: [
          {
            src: "banana",
            dst: "香蕉",
            regex: false,
            case_sensitive: false,
          },
        ],
        enabled: true,
        mode: "custom",
        revision: 1,
      },
      text_preserve: {
        entries: [
          {
            src: "^foo\\d+$",
            info: "preserve",
          },
        ],
        enabled: true,
        mode: "custom",
        revision: 1,
      },
    },
    prompts: {
      translation: {
        text: "",
        enabled: false,
        revision: 0,
      },
      analysis: {
        text: "",
        enabled: false,
        revision: 0,
      },
    },
    analysis: {},
    proofreading: {
      revision: 0,
    },
    task: {},
    revisions: {
      projectRevision: 1,
      sections: {
        items: 1,
        quality: 1,
      },
    },
  };
}

describe("createQualityStatisticsScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("warmupAll 会触发四类规则预热", async () => {
    let current_state = create_test_state();
    const store = createQualityStatisticsStore();
    const compute_by_rule_type = {
      glossary: vi.fn(async (input: QualityStatisticsTaskInput) => create_success_result(input)),
      pre_replacement: vi.fn(async (input: QualityStatisticsTaskInput) =>
        create_success_result(input),
      ),
      post_replacement: vi.fn(async (input: QualityStatisticsTaskInput) =>
        create_success_result(input),
      ),
      text_preserve: vi.fn(async (input: QualityStatisticsTaskInput) =>
        create_success_result(input),
      ),
    };
    const scheduler = createQualityStatisticsScheduler({
      store,
      get_project_state: () => current_state,
      get_executor: (rule_type) => {
        return {
          compute: compute_by_rule_type[rule_type],
        };
      },
    });

    scheduler.resetProject(current_state.project.path);
    scheduler.warmupAll();
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_BY_PRIORITY.warmup);

    expect(compute_by_rule_type.glossary).toHaveBeenCalledTimes(1);
    expect(compute_by_rule_type.pre_replacement).toHaveBeenCalledTimes(1);
    expect(compute_by_rule_type.post_replacement).toHaveBeenCalledTimes(1);
    expect(compute_by_rule_type.text_preserve).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("items 变更时会在后台刷新四类统计", async () => {
    let current_state = create_test_state();
    const store = createQualityStatisticsStore();
    const compute_by_rule_type = {
      glossary: vi.fn(async (input: QualityStatisticsTaskInput) => create_success_result(input)),
      pre_replacement: vi.fn(async (input: QualityStatisticsTaskInput) =>
        create_success_result(input),
      ),
      post_replacement: vi.fn(async (input: QualityStatisticsTaskInput) =>
        create_success_result(input),
      ),
      text_preserve: vi.fn(async (input: QualityStatisticsTaskInput) =>
        create_success_result(input),
      ),
    };
    const scheduler = createQualityStatisticsScheduler({
      store,
      get_project_state: () => current_state,
      get_executor: (rule_type) => {
        return {
          compute: compute_by_rule_type[rule_type],
        };
      },
    });

    scheduler.resetProject(current_state.project.path);
    scheduler.markItemsDirty();

    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_BY_PRIORITY.background - 1);
    expect(compute_by_rule_type.glossary).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(compute_by_rule_type.glossary).toHaveBeenCalledTimes(1);
    expect(compute_by_rule_type.pre_replacement).toHaveBeenCalledTimes(1);
    expect(compute_by_rule_type.post_replacement).toHaveBeenCalledTimes(1);
    expect(compute_by_rule_type.text_preserve).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("quality slice 变更时只刷新对应 rule type", async () => {
    const current_state = create_test_state();
    const store = createQualityStatisticsStore();
    const compute_by_rule_type = {
      glossary: vi.fn(async (input: QualityStatisticsTaskInput) => create_success_result(input)),
      pre_replacement: vi.fn(async (input: QualityStatisticsTaskInput) =>
        create_success_result(input),
      ),
      post_replacement: vi.fn(async (input: QualityStatisticsTaskInput) =>
        create_success_result(input),
      ),
      text_preserve: vi.fn(async (input: QualityStatisticsTaskInput) =>
        create_success_result(input),
      ),
    };
    const scheduler = createQualityStatisticsScheduler({
      store,
      get_project_state: () => current_state,
      get_executor: (rule_type) => {
        return {
          compute: compute_by_rule_type[rule_type],
        };
      },
    });

    scheduler.resetProject(current_state.project.path);
    scheduler.markQualityDirty("glossary");
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_BY_PRIORITY.background);

    expect(compute_by_rule_type.glossary).toHaveBeenCalledTimes(1);
    expect(compute_by_rule_type.pre_replacement).not.toHaveBeenCalled();
    expect(compute_by_rule_type.post_replacement).not.toHaveBeenCalled();
    expect(compute_by_rule_type.text_preserve).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it("同一 key 的并发刷新会保持 single-flight", async () => {
    const current_state = create_test_state();
    const store = createQualityStatisticsStore();
    const deferred = create_deferred<QualityStatisticsTaskResult>();
    const glossary_compute = vi.fn(() => deferred.promise);
    const scheduler = createQualityStatisticsScheduler({
      store,
      get_project_state: () => current_state,
      get_executor: (rule_type): QualityStatisticsTaskExecutor => {
        return {
          compute:
            rule_type === "glossary"
              ? glossary_compute
              : async (input: QualityStatisticsTaskInput) => create_success_result(input),
        };
      },
    });

    scheduler.resetProject(current_state.project.path);
    scheduler.markQualityDirty("glossary");
    scheduler.markQualityDirty("glossary");
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_BY_PRIORITY.background);

    expect(glossary_compute).toHaveBeenCalledTimes(1);

    deferred.resolve({
      results: {
        "apple::0": {
          matched_item_count: 2,
          subset_parents: [],
        },
      },
    });
    await Promise.resolve();
    scheduler.dispose();
  });

  it("迟到结果不会覆盖更新后的 revision 缓存", async () => {
    let current_state = create_test_state();
    const store = createQualityStatisticsStore();
    const first_deferred = create_deferred<QualityStatisticsTaskResult>();
    const second_deferred = create_deferred<QualityStatisticsTaskResult>();
    const glossary_compute = vi
      .fn<QualityStatisticsTaskExecutor["compute"]>()
      .mockImplementationOnce(() => first_deferred.promise)
      .mockImplementationOnce(() => second_deferred.promise);
    const scheduler = createQualityStatisticsScheduler({
      store,
      get_project_state: () => current_state,
      get_executor: (rule_type): QualityStatisticsTaskExecutor => {
        return {
          compute:
            rule_type === "glossary"
              ? glossary_compute
              : async (input: QualityStatisticsTaskInput) => create_success_result(input),
        };
      },
    });

    scheduler.resetProject(current_state.project.path);
    scheduler.markQualityDirty("glossary");
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_BY_PRIORITY.background);

    current_state = {
      ...current_state,
      quality: {
        ...current_state.quality,
        glossary: {
          ...current_state.quality.glossary,
          entries: [
            {
              src: "banana",
              dst: "Banana",
              info: "fruit",
              case_sensitive: false,
            },
          ],
          revision: current_state.quality.glossary.revision + 1,
        },
      },
    };
    scheduler.markQualityDirty("glossary");
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_BY_PRIORITY.background);

    second_deferred.resolve({
      results: {
        "banana::0": {
          matched_item_count: 5,
          subset_parents: [],
        },
      },
    });
    await Promise.resolve();

    first_deferred.resolve({
      results: {
        "apple::0": {
          matched_item_count: 1,
          subset_parents: [],
        },
      },
    });
    await Promise.resolve();

    expect(store.getSnapshot().caches.glossary.matched_count_by_entry_id).toEqual({
      "banana::0": 5,
    });
    scheduler.dispose();
  });

  it("执行异常后会进入 failed/stale，并能在后续刷新中恢复", async () => {
    const current_state = create_test_state();
    const store = createQualityStatisticsStore();
    const glossary_compute = vi
      .fn<QualityStatisticsTaskExecutor["compute"]>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        results: {
          "apple::0": {
            matched_item_count: 3,
            subset_parents: [],
          },
        },
      });
    const scheduler = createQualityStatisticsScheduler({
      store,
      get_project_state: () => current_state,
      get_executor: (rule_type): QualityStatisticsTaskExecutor => {
        return {
          compute:
            rule_type === "glossary"
              ? glossary_compute
              : async (input: QualityStatisticsTaskInput) => create_success_result(input),
        };
      },
    });

    scheduler.resetProject(current_state.project.path);
    scheduler.markQualityDirty("glossary");
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_BY_PRIORITY.background);

    expect(store.getSnapshot().caches.glossary.failed).toBe(true);
    expect(store.getSnapshot().caches.glossary.stale).toBe(true);
    expect(store.getSnapshot().caches.glossary.ready).toBe(false);

    scheduler.requestForeground("glossary");
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_BY_PRIORITY.foreground);

    expect(store.getSnapshot().caches.glossary.failed).toBe(false);
    expect(store.getSnapshot().caches.glossary.ready).toBe(true);
    expect(store.getSnapshot().caches.glossary.matched_count_by_entry_id).toEqual({
      "apple::0": 3,
    });
    scheduler.dispose();
  });
});
