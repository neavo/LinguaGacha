import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import {
  DesktopStateStoresContext,
  type DesktopStateStores,
} from "@frontend/app/state/desktop-state-context";
import { createProjectChangeSignalStore } from "@frontend/app/state/project-change-signal-store";
import { createRuntimeActivityStore } from "@frontend/app/state/runtime-activity-store";
import {
  createTaskSnapshotStore,
  normalize_task_snapshot,
} from "@frontend/app/state/task-snapshot-store";
import {
  useProjectChangeSignal,
  useRuntimeSnapshot,
  useSyncTaskSnapshot,
  useTaskSnapshot,
} from "@frontend/app/state/use-desktop-state";

describe("desktop state 精确订阅 hooks", () => {
  it("每个 hook 只响应自己的外部 store，task 写入口保持稳定", async () => {
    const stores: DesktopStateStores = {
      task: createTaskSnapshotStore(),
      runtime: createRuntimeActivityStore(),
      projectChange: createProjectChangeSignalStore(),
    };
    const renders = { task: 0, runtime: 0, project: 0 };
    const task_writers: Array<ReturnType<typeof useSyncTaskSnapshot>> = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DesktopStateStoresContext.Provider value={stores}>
          <TaskProbe
            onRender={(write) => {
              renders.task += 1;
              task_writers.push(write);
            }}
          />
          <RuntimeProbe
            onRender={() => {
              renders.runtime += 1;
            }}
          />
          <ProjectProbe
            onRender={() => {
              renders.project += 1;
            }}
          />
        </DesktopStateStoresContext.Provider>,
      );
    });
    const write_task = task_writers[0];
    if (write_task === undefined) throw new Error("缺少 task store 写入口。");

    await act(async () => {
      stores.runtime.applySnapshot({ revision: 1, owner: "agent" });
    });
    expect(renders).toEqual({ task: 1, runtime: 2, project: 1 });

    await act(async () => {
      write_task(
        normalize_task_snapshot({ task: { run_revision: 1, status: "running", busy: true } }),
      );
    });
    expect(renders).toEqual({ task: 2, runtime: 2, project: 1 });
    expect(task_writers[1]).toBe(write_task);

    await act(async () => {
      stores.projectChange.applySnapshot({
        seq: 1,
        reason: "items_updated",
        updated_sections: ["items"],
        results: [],
      });
    });
    expect(renders).toEqual({ task: 2, runtime: 2, project: 2 });

    await act(async () => root.unmount());
  });
});

function TaskProbe(props: { onRender: (write: ReturnType<typeof useSyncTaskSnapshot>) => void }) {
  useTaskSnapshot();
  const write = useSyncTaskSnapshot();
  props.onRender(write);
  return null;
}

function RuntimeProbe(props: { onRender: () => void }) {
  useRuntimeSnapshot();
  props.onRender();
  return null;
}

function ProjectProbe(props: { onRender: () => void }) {
  useProjectChangeSignal();
  props.onRender();
  return null;
}
