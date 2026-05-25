import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectItemPublicRecord } from "@base/item";
import type { ProjectStoreState } from "@/project/store/project-store";
import { createProjectItemIndex } from "@/project/store/project-item-index";
import type { QualityRuleStatisticsRuleType } from "@/project/quality/quality-rule-statistics-store";
import {
  QualityRuleStatisticsProvider,
  useQualityRuleStatistics,
} from "@/project/quality/quality-rule-statistics-context";

const { scheduler_mock } = vi.hoisted(() => {
  return {
    scheduler_mock: {
      markQualityDirty: vi.fn(),
      requestForeground: vi.fn(),
      resetProject: vi.fn(),
      dispose: vi.fn(),
    },
  };
});

let current_state: ProjectStoreState;
let current_project_session_status: "idle" | "warming" | "ready";
const project_store_listeners = new Set<() => void>();

const project_store = {
  subscribe(listener: () => void): () => void {
    project_store_listeners.add(listener);
    return () => {
      project_store_listeners.delete(listener);
    };
  },
  getState(): ProjectStoreState {
    return current_state;
  },
};

vi.mock("@/project/quality/quality-rule-statistics-scheduler", () => {
  return {
    createQualityRuleStatisticsScheduler: vi.fn(() => scheduler_mock),
  };
});

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      project_snapshot: current_state.project,
      project_store,
      project_session_status: current_project_session_status,
    }),
  };
});

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
        src: "苹果真甜",
        dst: "Apple is sweet",
      }),
    }),
    quality: {
      glossary: {
        entries: [
          {
            src: "苹果",
            dst: "Apple",
            info: "水果",
            case_sensitive: false,
          },
        ],
        enabled: true,
        mode: "custom",
        revision: 1,
      },
      pre_replacement: {
        entries: [],
        enabled: false,
        mode: "off",
        revision: 0,
      },
      post_replacement: {
        entries: [],
        enabled: false,
        mode: "off",
        revision: 0,
      },
      text_preserve: {
        entries: [],
        enabled: false,
        mode: "off",
        revision: 0,
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

function update_glossary_state(
  updater: (entry: Record<string, unknown>) => Record<string, unknown>,
): ProjectStoreState {
  const [first_entry, ...rest_entries] = current_state.quality.glossary.entries;

  return {
    ...current_state,
    quality: {
      ...current_state.quality,
      glossary: {
        ...current_state.quality.glossary,
        entries: [updater(first_entry ?? {}), ...rest_entries],
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
}

async function apply_project_state(next_state: ProjectStoreState): Promise<void> {
  await act(async () => {
    current_state = next_state;
    project_store_listeners.forEach((listener) => {
      listener();
    });
  });
}

describe("QualityRuleStatisticsProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(async () => {
    current_state = create_test_state();
    current_project_session_status = "ready";
    project_store_listeners.clear();
    vi.clearAllMocks();

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await render_provider();

    scheduler_mock.markQualityDirty.mockClear();
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

  function StatisticsProbe(props: {
    rule_type: QualityRuleStatisticsRuleType;
  }): JSX.Element | null {
    useQualityRuleStatistics(props.rule_type);
    return null;
  }

  async function render_provider(active_rule?: QualityRuleStatisticsRuleType): Promise<void> {
    await act(async () => {
      root?.render(
        <QualityRuleStatisticsProvider>
          {active_rule === undefined ? <span /> : <StatisticsProbe rule_type={active_rule} />}
        </QualityRuleStatisticsProvider>,
      );
    });
  }

  it.each([
    ["dst", (entry: Record<string, unknown>) => ({ ...entry, dst: "New Apple" }), undefined],
    ["info", (entry: Record<string, unknown>) => ({ ...entry, info: "新说明" }), undefined],
    [
      "enabled",
      (entry: Record<string, unknown>) => entry,
      (state: ProjectStoreState): ProjectStoreState => ({
        ...state,
        quality: {
          ...state.quality,
          glossary: {
            ...state.quality.glossary,
            enabled: !state.quality.glossary.enabled,
            revision: state.quality.glossary.revision + 1,
          },
        },
      }),
    ],
  ])("只改 glossary 的 %s 时不会标记统计依赖失效", async (_label, update_entry, update_state) => {
    const next_state =
      update_state === undefined
        ? update_glossary_state(update_entry)
        : update_state(current_state);

    await apply_project_state(next_state);

    expect(scheduler_mock.markQualityDirty).not.toHaveBeenCalledWith(
      "glossary" satisfies QualityRuleStatisticsRuleType,
    );
  });

  it.each([
    ["src", (entry: Record<string, unknown>) => ({ ...entry, src: "香蕉" })],
    ["case_sensitive", (entry: Record<string, unknown>) => ({ ...entry, case_sensitive: true })],
  ])("页面正在消费 glossary 时改 %s 会标记统计依赖失效", async (_label, update_entry) => {
    await render_provider("glossary");
    scheduler_mock.markQualityDirty.mockClear();

    await apply_project_state(update_glossary_state(update_entry));

    expect(scheduler_mock.markQualityDirty).toHaveBeenCalledWith(
      "glossary" satisfies QualityRuleStatisticsRuleType,
    );
  });

  it("页面未消费 glossary 时依赖变化不会安排后台刷新", async () => {
    await apply_project_state(
      update_glossary_state((entry) => ({
        ...entry,
        src: "香蕉",
      })),
    );

    expect(scheduler_mock.markQualityDirty).not.toHaveBeenCalledWith(
      "glossary" satisfies QualityRuleStatisticsRuleType,
    );
  });
});
