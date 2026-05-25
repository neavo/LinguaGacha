import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  QualityStatisticsTaskInput,
  QualityStatisticsTaskResult,
} from "@/project/quality/quality-statistics";
import type { ProjectItemPublicRecord } from "@base/item";
import type { ProjectStoreState } from "@/project/store/project-store";
import { createProjectItemIndex } from "@/project/store/project-item-index";
import {
  REFRESH_DELAY_BY_PRIORITY,
  createQualityRuleStatisticsScheduler,
} from "@/project/quality/quality-rule-statistics-scheduler";
import { createQualityRuleStatisticsStore } from "@/project/quality/quality-rule-statistics-store";
import type { QualityStatisticsTaskExecutor } from "@/project/quality/quality-statistics";

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

function create_test_item(overrides: Partial<ProjectItemPublicRecord>): ProjectItemPublicRecord {
  return {
    item_id: 1,
    src: "",
    dst: "",
    name_src: null,
    name_dst: null,
    extra_field: "",
    tag: "",
    row_number: 0,
    file_type: "TXT",
    file_path: "",
    text_type: "NONE",
    status: "NONE",
    retry_count: 0,
    skip_internal_filter: false,
    ...overrides,
  };
}

function create_test_state(): ProjectStoreState {
  return {
    project: {
      path: "E:/demo/sample.lg",
      loaded: true,
    },
    files: {},
    items: createProjectItemIndex({
      "1": create_test_item({
        item_id: 1,
        file_path: "chapter01.txt",
        src: "apple hero foo42",
        dst: "banana hero 保留",
      }),
    }),
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
    revisions: {
      projectRevision: 1,
      sections: {
        items: 1,
        quality: 1,
      },
    },
  };
}

describe("createQualityRuleStatisticsScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("quality slice 变更时只刷新对应 rule type", async () => {
    const current_state = create_test_state();
    const store = createQualityRuleStatisticsStore();
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
    const scheduler = createQualityRuleStatisticsScheduler({
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
    const store = createQualityRuleStatisticsStore();
    const deferred = create_deferred<QualityStatisticsTaskResult>();
    const glossary_compute = vi.fn(() => deferred.promise);
    const scheduler = createQualityRuleStatisticsScheduler({
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
    const store = createQualityRuleStatisticsStore();
    const first_deferred = create_deferred<QualityStatisticsTaskResult>();
    const second_deferred = create_deferred<QualityStatisticsTaskResult>();
    const glossary_compute = vi
      .fn<QualityStatisticsTaskExecutor["compute"]>()
      .mockImplementationOnce(() => first_deferred.promise)
      .mockImplementationOnce(() => second_deferred.promise);
    const scheduler = createQualityRuleStatisticsScheduler({
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

  it("删除无关联规则时只重映射缓存，不派发 worker", async () => {
    let current_state = create_test_state();
    current_state = {
      ...current_state,
      quality: {
        ...current_state.quality,
        glossary: {
          ...current_state.quality.glossary,
          entries: [
            ...current_state.quality.glossary.entries,
            {
              src: "1234567",
              dst: "",
              info: "",
              case_sensitive: false,
            },
          ],
        },
      },
    };
    const store = createQualityRuleStatisticsStore();
    const glossary_compute = vi.fn(async (input: QualityStatisticsTaskInput) => {
      return create_success_result(input);
    });
    const scheduler = createQualityRuleStatisticsScheduler({
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

    expect(glossary_compute).toHaveBeenCalledTimes(1);

    // 删除 1234567 后没有新增规则也没有关联目标，应只重映射缓存，不再派发 worker。
    current_state = {
      ...current_state,
      quality: {
        ...current_state.quality,
        glossary: {
          ...current_state.quality.glossary,
          entries: [current_state.quality.glossary.entries[0]!],
          revision: current_state.quality.glossary.revision + 1,
        },
      },
      revisions: {
        ...current_state.revisions,
        sections: {
          ...current_state.revisions.sections,
          quality: Number(current_state.revisions.sections.quality ?? 0) + 1,
        },
      },
    };
    scheduler.markQualityDirty("glossary");
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_BY_PRIORITY.background);

    const cache = store.getSnapshot().caches.glossary;
    expect(glossary_compute).toHaveBeenCalledTimes(1);
    expect(cache.phase).toBe("current");
    expect(cache.completed_entry_ids).toEqual(["apple::0"]);
    expect(cache.matched_count_by_entry_id).toEqual({
      "apple::0": 1,
    });
    scheduler.dispose();
  });

  it("执行异常后会进入 failed phase，并能在后续刷新中恢复", async () => {
    const current_state = create_test_state();
    const store = createQualityRuleStatisticsStore();
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
    const scheduler = createQualityRuleStatisticsScheduler({
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

    expect(store.getSnapshot().caches.glossary.phase).toBe("failed");

    scheduler.requestForeground("glossary");
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_BY_PRIORITY.foreground);

    expect(store.getSnapshot().caches.glossary.phase).toBe("current");
    expect(store.getSnapshot().caches.glossary.matched_count_by_entry_id).toEqual({
      "apple::0": 3,
    });
    scheduler.dispose();
  });
});
