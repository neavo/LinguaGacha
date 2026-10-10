import { createProjectChangeSignalStore } from "@frontend/app/state/project-change-signal-store";
import { type JSX, act, useEffect, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ProjectChangeApplyResult,
  ProjectStage,
} from "@frontend/app/state/desktop-project-change-types";
import type { ProjectSnapshot } from "@frontend/app/state/desktop-state-context";
import type { ProjectChangeSignal } from "@frontend/app/state/project-change-signal";
import type {
  QualityRuleStatisticsCacheSnapshot,
  QualityRuleStatisticsRuleType,
  QualityRuleStatisticsStore,
} from "@frontend/app/session/quality-rule-statistics-store";
import { QualityRuleStatisticsProvider } from "@frontend/app/session/quality-rule-statistics-provider";
import {
  QualityRuleStatisticsContext,
  useQualityRuleStatistics,
} from "@frontend/app/session/quality-rule-statistics-context";

const { api_fetch_mock } = vi.hoisted(() => {
  return {
    api_fetch_mock: vi.fn(),
  };
});

let current_project_snapshot: ProjectSnapshot;
let current_project_session_status: "idle" | "warming" | "ready";
let change_source: ReturnType<typeof createProjectChangeSignalStore>;

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
    }),
    useProjectChangeSignalSource: () => change_source,
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
 * 构造携带统计失效范围的项目通知。
 */
function create_project_change_result(args: {
  source: string;
  updatedSections: ProjectStage[];
}): ProjectChangeApplyResult {
  return {
    applied: true,
    source: args.source,
    projectRevision: 2,
    updatedSections: args.updatedSections,
    sectionRevisions: { items: 2 },
    qualityStatisticsScope: "post_replacement",
    items: { mode: "delta", changedIds: [1] },
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
    entry_ids: ["苹果::0"],
    hits_by_entry_id: {
      "苹果::0": 1,
    },
    subset_parents_by_entry_id: {},
    last_error: null,
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
  let current_store: QualityRuleStatisticsStore | null = null;

  beforeEach(() => {
    current_project_snapshot = create_project_snapshot();
    current_project_session_status = "ready";
    change_source = createProjectChangeSignalStore();
    api_fetch_mock.mockReset();
    api_fetch_mock.mockResolvedValue({
      projectPath: "E:/demo/sample.lg",
      statistics: create_statistics_snapshot(),
    });
    snapshots = [];
    current_store = null;

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
    current_store = useContext(QualityRuleStatisticsContext)?.store ?? null;
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
          hits_by_entry_id: { "苹果::0": 1 },
        }),
      })
      .mockResolvedValueOnce({
        projectPath: "E:/demo/sample.lg",
        statistics: create_statistics_snapshot({
          hits_by_entry_id: { "苹果::0": 3 },
        }),
      });

    await render_provider("glossary");
    await wait_for_condition(() => snapshots.at(-1)?.hits_by_entry_id["苹果::0"] === 1);

    await act(async () => {
      change_source.applySnapshot(
        create_project_change_signal({
          seq: 1,
          reason: "quality_rule_update",
          updated_sections: ["quality"],
          results: [
            {
              applied: true,
              source: "quality",
              projectRevision: 2,
              updatedSections: ["quality"],
              sectionRevisions: {},
              qualityStatisticsScope: "all",
            },
          ],
        }),
      );
    });
    await render_provider("glossary");

    await wait_for_condition(() => snapshots.at(-1)?.hits_by_entry_id["苹果::0"] === 3);

    expect(api_fetch_mock).toHaveBeenCalledTimes(2);
    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/statistics/view", {
      rule_key: "glossary",
    });
  });

  it("激活 glossary 后收到翻译批次时保留当前统计缓存", async () => {
    await render_provider("glossary");
    await wait_for_condition(() => snapshots.at(-1)?.phase === "current");

    await act(async () => {
      change_source.applySnapshot(
        create_project_change_signal({
          seq: 1,
          reason: "translation_batch_update",
          updated_sections: ["items"],
          results: [
            create_project_change_result({
              source: "translation_batch_update",
              updatedSections: ["items"],
            }),
          ],
        }),
      );
    });
    await render_provider("glossary");
    await act(async () => {
      await Promise.resolve();
    });

    expect(api_fetch_mock).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)).toMatchObject({
      phase: "current",
      entry_ids: ["苹果::0"],
    });
  });

  it("激活 post_replacement 后收到翻译批次时重新读取后端统计", async () => {
    api_fetch_mock
      .mockResolvedValueOnce({
        projectPath: "E:/demo/sample.lg",
        statistics: create_statistics_snapshot({
          hits_by_entry_id: { "苹果::0": 1 },
        }),
      })
      .mockResolvedValueOnce({
        projectPath: "E:/demo/sample.lg",
        statistics: create_statistics_snapshot({
          hits_by_entry_id: { "苹果::0": 4 },
        }),
      });

    await render_provider("post_replacement");
    await wait_for_condition(() => snapshots.at(-1)?.hits_by_entry_id["苹果::0"] === 1);

    await act(async () => {
      change_source.applySnapshot(
        create_project_change_signal({
          seq: 1,
          reason: "translation_batch_update",
          updated_sections: ["items"],
          results: [
            create_project_change_result({
              source: "translation_batch_update",
              updatedSections: ["items"],
            }),
          ],
        }),
      );
    });
    await render_provider("post_replacement");

    await wait_for_condition(() => snapshots.at(-1)?.hits_by_entry_id["苹果::0"] === 4);

    expect(api_fetch_mock).toHaveBeenCalledTimes(2);
    expect(api_fetch_mock).toHaveBeenLastCalledWith("/api/quality/statistics/view", {
      rule_key: "post_replacement",
    });
  });
  it.each(["warming", "unload", "switch"] as const)(
    "%s 撤销旧请求，同路径重新进入后只发布新结果",
    async (transition) => {
      const old = create_deferred<{
        projectPath: string;
        statistics: QualityRuleStatisticsCacheSnapshot;
      }>();
      const next = create_deferred<{
        projectPath: string;
        statistics: QualityRuleStatisticsCacheSnapshot;
      }>();
      api_fetch_mock.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
      await render_provider("glossary");
      expect(snapshots.at(-1)?.phase).toBe("running");
      if (transition === "warming") current_project_session_status = "warming";
      if (transition === "unload")
        current_project_snapshot = create_project_snapshot({ loaded: false, path: "" });
      if (transition === "switch") {
        current_project_session_status = "warming";
        current_project_snapshot = create_project_snapshot({ path: "other.lg" });
      }
      await render_provider("glossary");
      current_project_snapshot = create_project_snapshot();
      current_project_session_status = "ready";
      await render_provider("glossary");
      expect(api_fetch_mock).toHaveBeenCalledTimes(2);
      await act(async () => {
        old.resolve({
          projectPath: current_project_snapshot.path,
          statistics: create_statistics_snapshot({ entry_ids: ["old"] }),
        });
        await old.promise;
      });
      expect(snapshots.at(-1)).toMatchObject({ phase: "running", entry_ids: null });
      await act(async () => {
        next.resolve({
          projectPath: current_project_snapshot.path,
          statistics: create_statistics_snapshot({ entry_ids: ["new"] }),
        });
        await next.promise;
      });
      expect(snapshots.at(-1)?.entry_ids).toEqual(["new"]);
    },
  );
  it("挂载已有加载通知时只发出首次查询，并接纳完成结果", async () => {
    change_source.applySnapshot(
      create_project_change_signal({
        seq: 1,
        updated_sections: ["quality"],
        results: [
          {
            applied: true,
            source: "project_loaded",
            projectRevision: 1,
            sectionRevisions: {},
            updatedSections: ["quality"],
            qualityStatisticsScope: "all",
          },
        ],
      }),
    );
    const pending = create_deferred<{
      projectPath: string;
      statistics: QualityRuleStatisticsCacheSnapshot;
    }>();
    api_fetch_mock.mockReturnValueOnce(pending.promise);
    await render_provider("glossary");
    expect(api_fetch_mock).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({
        projectPath: current_project_snapshot.path,
        statistics: create_statistics_snapshot(),
      });
      await pending.promise;
    });
    expect(snapshots.at(-1)?.phase).toBe("current");
  });

  it("连续发布 all 和 none 时同步消费前一次失效", async () => {
    await render_provider("glossary");
    expect(snapshots.at(-1)?.phase).toBe("current");
    api_fetch_mock.mockResolvedValueOnce({
      projectPath: current_project_snapshot.path,
      statistics: create_statistics_snapshot({ entry_ids: ["new"] }),
    });
    await act(async () => {
      for (const [index, scope] of (["all", "none"] as const).entries()) {
        change_source.applySnapshot(
          create_project_change_signal({
            seq: index + 1,
            updated_sections: ["items"],
            results: [
              {
                applied: true,
                source: "write",
                projectRevision: index + 2,
                sectionRevisions: {},
                updatedSections: ["items"],
                qualityStatisticsScope: scope,
              },
            ],
          }),
        );
      }
    });
    expect(api_fetch_mock).toHaveBeenCalledTimes(2);
    expect(snapshots.at(-1)?.entry_ids).toEqual(["new"]);
  });
  it("作用域结束后取消订阅并撤销请求，迟到回包无法发布", async () => {
    const pending = create_deferred<{
      projectPath: string;
      statistics: QualityRuleStatisticsCacheSnapshot;
    }>();
    api_fetch_mock.mockReturnValueOnce(pending.promise);
    await render_provider("glossary");
    const store = current_store!;
    await act(async () => {
      root?.unmount();
      root = null;
    });
    expect(store.getSnapshot().project_path).toBe("");
    change_source.applySnapshot(
      create_project_change_signal({
        seq: 1,
        results: [
          {
            applied: true,
            source: "write",
            projectRevision: 1,
            sectionRevisions: {},
            updatedSections: ["quality"],
            qualityStatisticsScope: "all",
          },
        ],
      }),
    );
    pending.resolve({
      projectPath: current_project_snapshot.path,
      statistics: create_statistics_snapshot({ entry_ids: ["old"] }),
    });
    await pending.promise;
    await Promise.resolve();
    expect(store.getSnapshot().caches.glossary).toMatchObject({ phase: "empty", entry_ids: null });
    expect(api_fetch_mock).toHaveBeenCalledTimes(1);
  });
});
