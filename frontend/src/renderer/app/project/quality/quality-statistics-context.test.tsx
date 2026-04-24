import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectStoreState } from "@/app/project/store/project-store";
import type { QualityStatisticsRuleType } from "@/app/project/quality/quality-statistics-store";
import { QualityStatisticsProvider } from "@/app/project/quality/quality-statistics-context";

const { scheduler_mock } = vi.hoisted(() => {
  return {
    scheduler_mock: {
      warmupAll: vi.fn(),
      markQualityDirty: vi.fn(),
      requestForeground: vi.fn(),
      resetProject: vi.fn(),
      dispose: vi.fn(),
    },
  };
});

let current_state: ProjectStoreState;
let current_project_warmup_status: "idle" | "loading" | "ready";
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

vi.mock("@/app/project/quality/quality-statistics-scheduler", () => {
  return {
    createQualityStatisticsScheduler: vi.fn(() => scheduler_mock),
  };
});

vi.mock("@/app/runtime/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => ({
      project_snapshot: current_state.project,
      project_store,
      project_warmup_status: current_project_warmup_status,
    }),
  };
});

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
        src: "苹果真甜",
        dst: "Apple is sweet",
      },
    },
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

describe("QualityStatisticsProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(async () => {
    current_state = create_test_state();
    current_project_warmup_status = "ready";
    project_store_listeners.clear();
    vi.clearAllMocks();

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <QualityStatisticsProvider>
          <span />
        </QualityStatisticsProvider>,
      );
    });

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
      "glossary" satisfies QualityStatisticsRuleType,
    );
  });

  it.each([
    ["src", (entry: Record<string, unknown>) => ({ ...entry, src: "香蕉" })],
    ["case_sensitive", (entry: Record<string, unknown>) => ({ ...entry, case_sensitive: true })],
  ])("改 glossary 的 %s 时会标记统计依赖失效", async (_label, update_entry) => {
    await apply_project_state(update_glossary_state(update_entry));

    expect(scheduler_mock.markQualityDirty).toHaveBeenCalledWith(
      "glossary" satisfies QualityStatisticsRuleType,
    );
  });
});
