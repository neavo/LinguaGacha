import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProjectSessionProvider,
  useProjectSessionBarrier,
  useProjectSessionPageCacheRegistration,
} from "@/app/session/project-session-context";
import {
  createProjectStore,
  type ProjectDataSection,
  type ProjectDataSectionRevisions,
  type ProjectStoreChangeEvent,
} from "@/project/store/project-store";
import type {
  ProjectSessionPageCacheKind,
  ProjectSessionPageCacheSnapshot,
} from "@/app/session/project-session-barrier";

const REQUIRED_SECTIONS: ProjectDataSection[] = ["project", "files", "items", "analysis"];
const CURRENT_REVISIONS: ProjectDataSectionRevisions = {
  project: 1,
  files: 1,
  items: 1,
  analysis: 1,
  quality: 1,
  proofreading: 1,
};

type RuntimeFixture = {
  project_snapshot: {
    loaded: boolean;
    path: string;
  };
  project_session_status: "idle" | "warming" | "ready";
  project_store: ReturnType<typeof createProjectStore>;
};

const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

const workbench_cache_fixture: { current: ProjectSessionPageCacheSnapshot } = {
  current: create_workbench_cache_snapshot(),
};

const proofreading_cache_fixture: { current: ProjectSessionPageCacheSnapshot } = {
  current: create_proofreading_cache_snapshot(),
};

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => runtime_fixture.current,
  };
});

function create_runtime_fixture(): RuntimeFixture {
  const project_store = createProjectStore();
  project_store.applyProjectChange(
    {
      source: "project_read_sections",
      projectPath: "E:/demo/sample.lg",
      projectRevision: 1,
      updatedSections: ["project"],
      sectionRevisions: CURRENT_REVISIONS,
      operations: [
        create_replace_section_operation("project", {
          loaded: true,
          path: "E:/demo/sample.lg",
        }),
      ],
    },
    {
      revisionMode: "exact",
    },
  );
  return {
    project_snapshot: {
      loaded: true,
      path: "E:/demo/sample.lg",
    },
    project_session_status: "ready",
    project_store,
  };
}

// create_replace_section_operation 构造 ProjectStore 可识别的最小 canonical section 事件。
function create_replace_section_operation(
  section: ProjectDataSection,
  value: unknown,
): ProjectStoreChangeEvent["operations"][number] {
  const sections = {
    [section]: {
      payloadMode: "canonical-delta",
      data: value,
    },
  } as ProjectStoreChangeEvent["operations"][number]["sections"];
  return { sections };
}

// create_workbench_cache_snapshot 构造已挂载工作台缓存的默认 ready 快照。
function create_workbench_cache_snapshot(): ProjectSessionPageCacheSnapshot {
  return {
    consumedRevisions: CURRENT_REVISIONS,
    fileOperationRunning: false,
    isRefreshing: false,
    requiredSections: REQUIRED_SECTIONS,
    settledProjectPath: "E:/demo/sample.lg",
  };
}

// create_proofreading_cache_snapshot 构造已挂载校对页缓存的默认 ready 快照。
function create_proofreading_cache_snapshot(): ProjectSessionPageCacheSnapshot {
  return {
    consumedRevisions: CURRENT_REVISIONS,
    isRefreshing: false,
    requiredSections: ["project", "items", "quality", "proofreading"],
    settledProjectPath: "E:/demo/sample.lg",
  };
}

describe("ProjectSessionProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_barrier_api: ReturnType<typeof useProjectSessionBarrier> | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    latest_barrier_api = null;
    runtime_fixture.current = create_runtime_fixture();
    workbench_cache_fixture.current = create_workbench_cache_snapshot();
    proofreading_cache_fixture.current = create_proofreading_cache_snapshot();
  });

  function BarrierProbe(): JSX.Element | null {
    const barrier_api = useProjectSessionBarrier();

    useEffect(() => {
      latest_barrier_api = barrier_api;
    }, [barrier_api]);

    return null;
  }

  function PageCacheProbe(props: { kind: ProjectSessionPageCacheKind }): JSX.Element | null {
    const snapshot =
      props.kind === "workbench"
        ? workbench_cache_fixture.current
        : proofreading_cache_fixture.current;
    useProjectSessionPageCacheRegistration(props.kind, snapshot);
    return null;
  }

  async function render_provider(
    options: {
      workbench?: boolean;
      proofreading?: boolean;
    } = {},
  ): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(
        <ProjectSessionProvider>
          <BarrierProbe />
          {options.workbench === true ? <PageCacheProbe kind="workbench" /> : null}
          {options.proofreading === true ? <PageCacheProbe kind="proofreading" /> : null}
        </ProjectSessionProvider>,
      );
    });
  }

  it("project_session_ready 只等待 session ready，不等待页面缓存", async () => {
    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_session_status: "warming",
    };
    await render_provider();

    let resolved = false;
    const wait_task = latest_barrier_api?.wait_for_barrier("project_session_ready", {
      projectPath: "E:/demo/sample.lg",
    });
    wait_task?.then(() => {
      resolved = true;
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(resolved).toBe(false);

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_session_status: "ready",
    };
    await render_provider();

    await act(async () => {
      await wait_task;
    });
    expect(resolved).toBe(true);
  });

  it("未挂载校对页时 proofreading_cache_refresh 立即 ready", async () => {
    await render_provider({ workbench: true });

    await expect(
      latest_barrier_api?.wait_for_barrier("proofreading_cache_refresh", {
        projectPath: "E:/demo/sample.lg",
      }),
    ).resolves.toBeUndefined();
  });

  it("已挂载工作台缓存需要覆盖当前 revision 后 workbench_cache_refresh 才 ready", async () => {
    await render_provider({ workbench: true });
    const checkpoint = latest_barrier_api?.create_barrier_checkpoint();

    await act(async () => {
      runtime_fixture.current.project_store.applyProjectChange({
        source: "project_read_sections",
        projectPath: "E:/demo/sample.lg",
        projectRevision: 2,
        updatedSections: ["analysis"],
        sectionRevisions: {
          analysis: 2,
        },
        operations: [],
      });
    });
    await render_provider({ workbench: true });

    let resolved = false;
    const wait_task = latest_barrier_api?.wait_for_barrier("workbench_cache_refresh", {
      projectPath: "E:/demo/sample.lg",
      checkpoint,
    });
    wait_task?.then(() => {
      resolved = true;
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(resolved).toBe(false);

    workbench_cache_fixture.current = {
      ...workbench_cache_fixture.current,
      consumedRevisions: {
        ...workbench_cache_fixture.current.consumedRevisions,
        analysis: 2,
      },
    };
    await render_provider({ workbench: true });

    await act(async () => {
      await wait_task;
    });
    expect(resolved).toBe(true);
  });

  it("workbench_file_operation 会等待已挂载工作台文件操作结束", async () => {
    workbench_cache_fixture.current = {
      ...workbench_cache_fixture.current,
      fileOperationRunning: true,
    };
    await render_provider({ workbench: true });

    let resolved = false;
    const wait_task = latest_barrier_api?.wait_for_barrier("workbench_file_operation", {
      projectPath: "E:/demo/sample.lg",
    });
    wait_task?.then(() => {
      resolved = true;
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(resolved).toBe(false);

    workbench_cache_fixture.current = {
      ...workbench_cache_fixture.current,
      fileOperationRunning: false,
    };
    await render_provider({ workbench: true });

    await act(async () => {
      await wait_task;
    });
    expect(resolved).toBe(true);
  });
});
