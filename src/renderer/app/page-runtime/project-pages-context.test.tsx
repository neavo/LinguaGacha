import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProjectPagesProvider,
  useProjectPagesBarrier,
} from "@/app/page-runtime/project-pages-context";
import {
  createProjectStore,
  createProjectStoreReplaceSectionChange,
  type ProjectDataSection,
  type ProjectDataSectionRevisions,
} from "@/project/store/project-store";

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
  project_warmup_status: "idle" | "warming" | "ready";
  set_project_warmup_status: ReturnType<typeof vi.fn>;
  project_store: ReturnType<typeof createProjectStore>;
};

type ProofreadingFixture = {
  consumed_revisions: ProjectDataSectionRevisions;
  is_refreshing: boolean;
  required_sections: ProjectDataSection[];
  settled_project_path: string;
};

type WorkbenchFixture = {
  consumed_revisions: ProjectDataSectionRevisions;
  file_op_running: boolean;
  is_refreshing: boolean;
  required_sections: ProjectDataSection[];
  settled_project_path: string;
};

const runtime_fixture: { current: RuntimeFixture } = {
  current: create_runtime_fixture(),
};

const proofreading_fixture: { current: ProofreadingFixture } = {
  current: create_proofreading_fixture(),
};

const workbench_fixture: { current: WorkbenchFixture } = {
  current: create_workbench_fixture(),
};

vi.mock("@/app/desktop/use-desktop-runtime", () => {
  return {
    useDesktopRuntime: () => runtime_fixture.current,
  };
});

vi.mock("@/app/navigation/screen-registry", () => {
  return {
    useProjectPagesRuntimeAdapters: () => ({
      proofreading_page_state: proofreading_fixture.current,
      workbench_live_state: workbench_fixture.current,
    }),
  };
});

function create_runtime_fixture(): RuntimeFixture {
  const project_store = createProjectStore();
  project_store.applyProjectChange(
    {
      source: "project_read_sections",
      projectRevision: 1,
      updatedSections: ["project"],
      sectionRevisions: CURRENT_REVISIONS,
      operations: [
        createProjectStoreReplaceSectionChange("project", {
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
    project_warmup_status: "ready",
    set_project_warmup_status: vi.fn(),
    project_store,
  };
}

function create_proofreading_fixture(): ProofreadingFixture {
  return {
    consumed_revisions: CURRENT_REVISIONS,
    is_refreshing: false,
    required_sections: ["project", "items", "quality", "proofreading"],
    settled_project_path: "E:/demo/sample.lg",
  };
}

function create_workbench_fixture(): WorkbenchFixture {
  return {
    consumed_revisions: CURRENT_REVISIONS,
    file_op_running: false,
    is_refreshing: false,
    required_sections: REQUIRED_SECTIONS,
    settled_project_path: "E:/demo/sample.lg",
  };
}

describe("ProjectPagesProvider", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_barrier_api: ReturnType<typeof useProjectPagesBarrier> | null = null;

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
    proofreading_fixture.current = create_proofreading_fixture();
    workbench_fixture.current = create_workbench_fixture();
  });

  function BarrierProbe(): JSX.Element | null {
    const barrier_api = useProjectPagesBarrier();

    useEffect(() => {
      latest_barrier_api = barrier_api;
    }, [barrier_api]);

    return null;
  }

  async function render_provider(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(
        <ProjectPagesProvider>
          <BarrierProbe />
        </ProjectPagesProvider>,
      );
    });
  }

  it("工程路径不变的 warmup 重启完成后也会回到 ready", async () => {
    const set_project_warmup_status = runtime_fixture.current.set_project_warmup_status;

    await render_provider();
    expect(set_project_warmup_status).not.toHaveBeenCalled();

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_warmup_status: "warming",
    };
    proofreading_fixture.current = {
      ...proofreading_fixture.current,
      is_refreshing: true,
    };
    workbench_fixture.current = {
      ...workbench_fixture.current,
      is_refreshing: true,
    };

    await render_provider();
    expect(set_project_warmup_status.mock.calls).toEqual([["warming"]]);

    proofreading_fixture.current = {
      ...proofreading_fixture.current,
      is_refreshing: false,
    };
    workbench_fixture.current = {
      ...workbench_fixture.current,
      is_refreshing: false,
    };

    await render_provider();
    expect(set_project_warmup_status.mock.calls).toEqual([["warming"], ["ready"]]);
  });

  it("只要工作台 ready，project warmup 就可以回到 ready", async () => {
    const set_project_warmup_status = runtime_fixture.current.set_project_warmup_status;

    runtime_fixture.current = {
      ...runtime_fixture.current,
      project_warmup_status: "warming",
    };
    proofreading_fixture.current = {
      ...proofreading_fixture.current,
      is_refreshing: true,
      settled_project_path: "",
    };
    workbench_fixture.current = {
      ...workbench_fixture.current,
      is_refreshing: false,
      settled_project_path: "E:/demo/sample.lg",
    };

    await render_provider();

    expect(set_project_warmup_status.mock.calls).toEqual([["warming"], ["ready"]]);
  });

  it("旧 render 捕获的 wait_for_barrier 也会读取最新 barrier 状态", async () => {
    runtime_fixture.current = {
      project_snapshot: {
        loaded: false,
        path: "",
      },
      project_warmup_status: "idle",
      set_project_warmup_status: vi.fn(),
      project_store: createProjectStore(),
    };
    proofreading_fixture.current = {
      ...create_proofreading_fixture(),
      settled_project_path: "",
    };
    workbench_fixture.current = {
      ...create_workbench_fixture(),
      settled_project_path: "",
    };

    await render_provider();
    const stale_wait_for_barrier = latest_barrier_api?.wait_for_barrier;
    expect(stale_wait_for_barrier).toBeTypeOf("function");

    runtime_fixture.current = create_runtime_fixture();
    proofreading_fixture.current = create_proofreading_fixture();
    workbench_fixture.current = create_workbench_fixture();

    await render_provider();

    let resolved = false;
    const wait_task = stale_wait_for_barrier?.("project_warmup", {
      projectPath: "E:/demo/sample.lg",
    });

    await act(async () => {
      await wait_task?.then(() => {
        resolved = true;
      });
    });

    expect(resolved).toBe(true);
  });

  it("project_warmup barrier 会等待工作台覆盖当前 revision", async () => {
    await render_provider();

    const checkpoint = latest_barrier_api?.create_barrier_checkpoint();
    expect(checkpoint).not.toBeNull();
    await act(async () => {
      runtime_fixture.current.project_store.alignRevisions({
        projectRevision: 2,
        sectionRevisions: {
          analysis: 2,
        },
      });
    });
    await render_provider();

    let resolved = false;
    const wait_task = latest_barrier_api?.wait_for_barrier("project_warmup", {
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

    workbench_fixture.current = {
      ...workbench_fixture.current,
      consumed_revisions: {
        ...workbench_fixture.current.consumed_revisions,
        analysis: 2,
      },
    };

    await render_provider();

    await act(async () => {
      await wait_task;
    });

    expect(resolved).toBe(true);
  });
});
