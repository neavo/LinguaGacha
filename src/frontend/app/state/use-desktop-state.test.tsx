import { empty_batch_task_list_snapshot } from "@shared/batch-task";
import { createBatchTaskSnapshotStore } from "@frontend/app/state/batch-task-snapshot-store";
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
  useProjectChangeSignal,
  useProjectChangeSignalSource,
  useRuntimeSnapshot,
  useBatchTaskSnapshot,
} from "@frontend/app/state/use-desktop-state";

describe("desktop state hooks", () => {
  it("从各自 store 读取快照并通过 task 写入口更新任务", async () => {
    const change_source = createProjectChangeSignalStore();
    const stores: DesktopStateStores = {
      batch_task: createBatchTaskSnapshotStore(),
      runtime: createRuntimeActivityStore(),
      projectChange: change_source,
    };
    let observed!: ReturnType<typeof useDesktopStateProbe>;
    const container = document.createElement("div");
    const root = createRoot(container);

    function Probe(): null {
      observed = useDesktopStateProbe();
      return null;
    }

    await act(async () => {
      root.render(
        <DesktopStateStoresContext.Provider value={stores}>
          <Probe />
        </DesktopStateStoresContext.Provider>,
      );
    });

    await act(async () => {
      stores.batch_task.applySnapshot({ ...empty_batch_task_list_snapshot(), revision: 1 });
      stores.runtime.applySnapshot({ revision: 2, owner: "agent" });
      change_source.applySnapshot({
        seq: 3,
        reason: "items_updated",
        updated_sections: ["items"],
        results: [],
      });
    });

    expect(observed.batch_tasks).toMatchObject({ revision: 1 });
    expect(observed.runtime).toMatchObject({ revision: 2, owner: "agent" });
    expect(observed.projectChange).toMatchObject({ seq: 3, updated_sections: ["items"] });
    expect(observed.changeSource).toBe(change_source);

    await act(async () => root.unmount());
  });
});

function useDesktopStateProbe() {
  return {
    batch_tasks: useBatchTaskSnapshot(),
    runtime: useRuntimeSnapshot(),
    projectChange: useProjectChangeSignal(),
    changeSource: useProjectChangeSignalSource(),
  };
}
