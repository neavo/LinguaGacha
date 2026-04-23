// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { create_empty_proofreading_snapshot } from "@/pages/proofreading-page/types";
import { useProofreadingPageState } from "@/pages/proofreading-page/use-proofreading-page-state";

type RuntimeFixture = {
  settings_snapshot: Record<string, unknown>;
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  project_store: {
    getState: () => Record<string, unknown>;
  };
  task_snapshot: {
    busy: boolean;
  };
  proofreading_change_signal: {
    seq: number;
  };
  commit_local_project_patch: ReturnType<typeof vi.fn>;
  refresh_project_runtime: ReturnType<typeof vi.fn>;
  align_project_runtime_ack: ReturnType<typeof vi.fn>;
};

type NavigationFixture = {
  proofreading_lookup_intent: null;
  clear_proofreading_lookup_intent: ReturnType<typeof vi.fn>;
};

type ProofreadingRuntimeClientFixture = {
  compute: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

const navigation_fixture: { current: NavigationFixture } = {
  current: create_navigation_fixture(),
};

const proofreading_runtime_client_fixture: { current: ProofreadingRuntimeClientFixture } = {
  current: create_proofreading_runtime_client_fixture(),
};

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/state/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => runtime_fixture.current,
  };
});

vi.mock("@/app/state/use-desktop-toast", () => {
  return {
    useDesktopToast: () => {
      return {
        push_toast: vi.fn(),
      };
    },
  };
});

vi.mock("@/app/navigation/navigation-context", () => {
  return {
    useAppNavigation: () => navigation_fixture.current,
  };
});

vi.mock("@/i18n", () => {
  return {
    useI18n: () => {
      return {
        t: (key: string) => key,
      };
    },
  };
});

vi.mock("@/pages/proofreading-page/proofreading-runtime", () => {
  return {
    applyProofreadingFilters: ({ snapshot, filters }: Record<string, any>) => {
      return {
        ...snapshot,
        filters,
      };
    },
    buildProofreadingRuntimeInput: ({ state }: Record<string, any>) => state,
  };
});

vi.mock("@/pages/proofreading-page/proofreading-runtime-client", () => {
  return {
    createProofreadingRuntimeClient: () => proofreading_runtime_client_fixture.current,
  };
});

vi.mock("@/app/desktop-api", () => {
  return {
    api_fetch: vi.fn(),
  };
});

function create_runtime_fixture(): RuntimeFixture {
  return {
    settings_snapshot: {},
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
    },
    project_store: {
      getState: () => {
        return {};
      },
    },
    task_snapshot: {
      busy: false,
    },
    proofreading_change_signal: {
      seq: 0,
    },
    commit_local_project_patch: vi.fn(() => {
      return {
        rollback: vi.fn(),
      };
    }),
    refresh_project_runtime: vi.fn(async () => {}),
    align_project_runtime_ack: vi.fn(),
  };
}

function create_navigation_fixture(): NavigationFixture {
  return {
    proofreading_lookup_intent: null,
    clear_proofreading_lookup_intent: vi.fn(),
  };
}

function create_proofreading_runtime_client_fixture(): ProofreadingRuntimeClientFixture {
  return {
    compute: vi.fn(async () => create_empty_proofreading_snapshot()),
    dispose: vi.fn(),
  };
}

describe("useProofreadingPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useProofreadingPageState> | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    latest_state = null;
    runtime_fixture.current = create_runtime_fixture();
    navigation_fixture.current = create_navigation_fixture();
    proofreading_runtime_client_fixture.current = create_proofreading_runtime_client_fixture();
  });

  function ProofreadingProbe(): JSX.Element | null {
    latest_state = useProofreadingPageState();
    return null;
  }

  async function flush_async_updates(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(createElement(ProofreadingProbe));
    });
    await flush_async_updates();
  }

  it("项目路径切换后会先保持未 settled，不会对空 store 立刻计算缓存", async () => {
    await render_hook();

    expect(latest_state).not.toBeNull();
    expect(proofreading_runtime_client_fixture.current.compute).not.toHaveBeenCalled();
    expect(latest_state?.cache_status).toBe("refreshing");
    expect(latest_state?.settled_project_path).toBe("");
    expect(latest_state?.last_loaded_at).toBeNull();
  });

  it("收到校对页变更信号后才会刷新并进入 ready", async () => {
    proofreading_runtime_client_fixture.current.compute = vi.fn(async () => {
      return {
        ...create_empty_proofreading_snapshot(),
        revision: 1,
      };
    });

    await render_hook();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      proofreading_change_signal: {
        seq: 1,
      },
    };

    await render_hook();

    expect(latest_state).not.toBeNull();
    expect(proofreading_runtime_client_fixture.current.compute).toHaveBeenCalledTimes(1);
    expect(latest_state?.cache_status).toBe("ready");
    expect(latest_state?.settled_project_path).toBe("E:/demo/sample.lg");
    expect(latest_state?.full_snapshot.revision).toBe(1);
  });
});
