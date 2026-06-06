import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ProjectChangeApplyResult,
  ProjectStage,
} from "@frontend/app/state/desktop-project-change-types";
import type {
  ProjectChangeSignal,
  ProjectSnapshot,
} from "@frontend/app/state/desktop-state-context";
import type {
  QualityRuleStatisticsCacheSnapshot,
  QualityRuleStatisticsRuleType,
} from "@frontend/app/session/quality-rule-statistics-store";
import {
  QualityRuleStatisticsProvider,
  useQualityRuleStatistics,
} from "@frontend/app/session/quality-rule-statistics-context";

const { api_fetch_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
  };
});

let current_project_snapshot: ProjectSnapshot;
let current_project_session_status: "idle" | "warming" | "ready";
let current_project_change_signal: ProjectChangeSignal;

vi.mock("@frontend/app/desktop/desktop-api", () => {
  return {
    api_fetch: api_fetch_mock,
  };
});

vi.mock("@frontend/app/state/use-desktop-state", () => {
  return {
    useDesktopState: () => ({
      project_snapshot: current_project_snapshot,
      project_session_status: current_project_session_status,
      project_change_signal: current_project_change_signal,
    }),
  };
});

/**
 * 构造 Provider 依赖的项目身份快照，测试只覆盖 loaded/path 对统计请求的影响。
 */
function create_project_snapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    path: "E:/demo/sample.lg",
    loaded: true,
    ...overrides,
  };
}

/**
 * 构造项目变更信号，默认空信号表达初始运行态。
 */
function create_project_change_signal(
  overrides: Partial<ProjectChangeSignal> = {},
): ProjectChangeSignal {
  return {
    seq: 0,
    reason: "",
    updated_sections: [],
    results: [],
    ...overrides,
  };
}

/**
 * 构造带 itemDelta 的公开项目变更结果，供失效规则判断真实 item 写入来源。
 */
function create_project_change_result(args: {
  source: string;
  updatedSections: ProjectStage[];
  fieldPatch?: NonNullable<ProjectChangeApplyResult["itemDelta"]>["fieldPatch"];
}): ProjectChangeApplyResult {
  return {
    applied: true,
    source: args.source,
    projectRevision: 2,
    updatedSections: args.updatedSections,
    sectionRevisions: { items: 2 },
    itemDelta: {
      upsertItemIds: [1],
      deleteItemIds: [],
      fullReplace: false,
      ...(args.fieldPatch === undefined ? {} : { fieldPatch: args.fieldPatch }),
    },
  };
}

/**
 * 构造后端统计 query 的完成快照，测试通过 overrides 表达新旧结果差异。
 */
function create_statistics_snapshot(
  overrides: Partial<QualityRuleStatisticsCacheSnapshot> = {},
): QualityRuleStatisticsCacheSnapshot {
  return {
    phase: "current",
    current_snapshot: {
      text_source: "src",
      text_signature: "source",
      dependency_signature: "current",
      snapshot_signature: "current",
      rules: [],
    },
    completed_snapshot: {
      text_source: "src",
      text_signature: "source",
      dependency_signature: "completed",
      snapshot_signature: "completed",
      rules: [],
    },
    completed_entry_ids: ["苹果::0"],
    matched_count_by_entry_id: {
      "苹果::0": 1,
    },
    subset_parent_labels_by_entry_id: {},
    last_error: null,
    request_token: 0,
    updated_at: null,
    ...overrides,
  };
}

/**
 * 等待 Provider effect 和 store 订阅都完成一次收敛。
 */
async function wait_for_condition(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }

    await act(async () => {
      await Promise.resolve();
    });
  }

  throw new Error("等待质量统计 Provider 状态收敛失败。");
}

/**
 * 手动控制后端 query 完成时机，用于覆盖旧项目结果和迟到请求。
 */
function create_deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve_deferred: (value: T) => void = () => {};
  let reject_deferred: (error: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolve_deferred = resolve;
    reject_deferred = reject;
  });

  return {
    promise,
    resolve: resolve_deferred,
    reject: reject_deferred,
  };
}

describe("QualityRuleStatisticsProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let snapshots: QualityRuleStatisticsCacheSnapshot[] = [];

  beforeEach(() => {
    current_project_snapshot = create_project_snapshot();
    current_project_session_status = "ready";
    current_project_change_signal = create_project_change_signal();
    api_fetch_mock.mockReset();
    api_fetch_mock.mockResolvedValue({
      projectPath: "E:/demo/sample.lg",
      statistics: create_statistics_snapshot(),
    });
    snapshots = [];

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  /**
   * 探针组件只暴露 hook 的公开快照，测试不读取 Provider 内部字段。
   */
  function StatisticsProbe(props: {
    rule_type: QualityRuleStatisticsRuleType;
  }): JSX.Element | null {
    const snapshot = useQualityRuleStatistics(props.rule_type);

    useEffect(() => {
      snapshots.push(snapshot);
    }, [snapshot]);

    return null;
  }

  /**
   * 渲染 Provider 并按需激活单个规则，保持每个用例只观察一个主规则。
   */
  async function render_provider(active_rule?: QualityRuleStatisticsRuleType): Promise<void> {
    await act(async () => {
      root?.render(
        <QualityRuleStatisticsProvider>
          {active_rule === undefined ? <span /> : <StatisticsProbe rule_type={active_rule} />}
        </QualityRuleStatisticsProvider>,
      );
    });
  }

  it("页面消费规则时向 Backend query 请求统计并写入当前快照", async () => {
    await render_provider("glossary");

    await wait_for_condition(() => snapshots.at(-1)?.phase === "current");

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/quality/statistics/view", {
      rule_key: "glossary",
    });
    expect(snapshots.at(-1)).toMatchObject({
      phase: "current",
      completed_entry_ids: ["苹果::0"],
      matched_count_by_entry_id: {
        "苹果::0": 1,
      },
      last_error: null,
    });
    expect(snapshots.at(-1)?.request_token).toBeGreaterThan(0);
    expect(snapshots.at(-1)?.updated_at).toEqual(expect.any(Number));
  });

  it("项目会话未 ready 时消费规则不会请求后端", async () => {
    current_project_session_status = "warming";

    await render_provider("glossary");
    await act(async () => {
      await Promise.resolve();
    });

    expect(api_fetch_mock).not.toHaveBeenCalled();
    expect(snapshots.at(-1)).toMatchObject({
      phase: "empty",
    });
  });

  it("后端返回旧项目结果时保留当前请求的运行态", async () => {
    const deferred = create_deferred<{
      projectPath: string;
      statistics: QualityRuleStatisticsCacheSnapshot;
    }>();
    api_fetch_mock.mockReturnValueOnce(deferred.promise);

    await render_provider("glossary");
    await wait_for_condition(() => snapshots.at(-1)?.phase === "running");
    await act(async () => {
      deferred.resolve({
        projectPath: "E:/demo/old.lg",
        statistics: create_statistics_snapshot({
          completed_entry_ids: ["过期::0"],
        }),
      });
      await deferred.promise;
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/quality/statistics/view", {
      rule_key: "glossary",
    });
    expect(snapshots.at(-1)).toMatchObject({
      phase: "running",
      completed_entry_ids: [],
    });
  });

  it("后端 query 失败时把规则缓存标记为 failed", async () => {
    api_fetch_mock.mockRejectedValueOnce(new Error("统计读取失败"));

    await render_provider("glossary");

    await wait_for_condition(() => snapshots.at(-1)?.phase === "failed");

    expect(snapshots.at(-1)?.last_error).toBeInstanceOf(Error);
    expect(snapshots.at(-1)?.last_error?.message).toBe("统计读取失败");
  });

  it("项目从 warming 进入 ready 后刷新已激活规则", async () => {
    current_project_session_status = "warming";
    await render_provider("glossary");
    expect(api_fetch_mock).not.toHaveBeenCalled();

    current_project_session_status = "ready";
    await render_provider("glossary");

    await wait_for_condition(() => snapshots.at(-1)?.phase === "current");

    expect(api_fetch_mock).toHaveBeenCalledWith("/api/quality/statistics/view", {
      rule_key: "glossary",
    });
    expect(snapshots.at(-1)?.phase).toBe("current");
  });

  it("项目 quality 变化后让当前统计缓存失效并重新读取后端", async () => {
    api_fetch_mock
      .mockResolvedValueOnce({
        projectPath: "E:/demo/sample.lg",
        statistics: create_statistics_snapshot({
          matched_count_by_entry_id: { "苹果::0": 1 },
        }),
      })
      .mockResolvedValueOnce({
        projectPath: "E:/demo/sample.lg",
        statistics: create_statistics_snapshot({
          matched_count_by_entry_id: { "苹果::0": 3 },
        }),
      });

    await render_provider("glossary");
    await wait_for_condition(() => snapshots.at(-1)?.matched_count_by_entry_id["苹果::0"] === 1);

    current_project_change_signal = create_project_change_signal({
      seq: 1,
      reason: "quality_rule_save_entries",
      updated_sections: ["quality"],
    });
    await render_provider("glossary");

    await wait_for_condition(() => snapshots.at(-1)?.matched_count_by_entry_id["苹果::0"] === 3);

    expect(api_fetch_mock).toHaveBeenCalledTimes(2);
    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/statistics/view", {
      rule_key: "glossary",
    });
  });

  it("激活 glossary 后收到翻译批次时保留当前统计缓存", async () => {
    await render_provider("glossary");
    await wait_for_condition(() => snapshots.at(-1)?.phase === "current");

    current_project_change_signal = create_project_change_signal({
      seq: 1,
      reason: "translation_batch_update",
      updated_sections: ["items"],
      results: [
        create_project_change_result({
          source: "translation_batch_update",
          updatedSections: ["items"],
        }),
      ],
    });
    await render_provider("glossary");
    await act(async () => {
      await Promise.resolve();
    });

    expect(api_fetch_mock).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toMatchObject({
      phase: "current",
      completed_entry_ids: ["苹果::0"],
    });
  });

  it("激活 post_replacement 后收到翻译批次时重新读取后端统计", async () => {
    api_fetch_mock
      .mockResolvedValueOnce({
        projectPath: "E:/demo/sample.lg",
        statistics: create_statistics_snapshot({
          matched_count_by_entry_id: { "苹果::0": 1 },
        }),
      })
      .mockResolvedValueOnce({
        projectPath: "E:/demo/sample.lg",
        statistics: create_statistics_snapshot({
          matched_count_by_entry_id: { "苹果::0": 4 },
        }),
      });

    await render_provider("post_replacement");
    await wait_for_condition(() => snapshots.at(-1)?.matched_count_by_entry_id["苹果::0"] === 1);

    current_project_change_signal = create_project_change_signal({
      seq: 1,
      reason: "translation_batch_update",
      updated_sections: ["items"],
      results: [
        create_project_change_result({
          source: "translation_batch_update",
          updatedSections: ["items"],
        }),
      ],
    });
    await render_provider("post_replacement");

    await wait_for_condition(() => snapshots.at(-1)?.matched_count_by_entry_id["苹果::0"] === 4);

    expect(api_fetch_mock).toHaveBeenCalledTimes(2);
    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/statistics/view", {
      rule_key: "post_replacement",
    });
  });
});
