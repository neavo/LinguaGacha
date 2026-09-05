import { normalize_batch_translation_snapshot } from "@shared/workbench/batch-translation";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import {
  DesktopStateStoresContext,
  type DesktopStateStores,
} from "@frontend/app/state/desktop-state-context";
import { createProjectChangeSignalStore } from "@frontend/app/state/project-change-signal-store";
import { createRuntimeActivityStore } from "@frontend/app/state/runtime-activity-store";
import { createBatchTranslationSnapshotStore } from "@frontend/app/state/batch-translation-snapshot-store";
import {
  useProjectChangeSignal,
  useRuntimeSnapshot,
  useSyncBatchTranslationSnapshot,
  useBatchTranslationSnapshot,
} from "@frontend/app/state/use-desktop-state";

describe("desktop state hooks", () => {
  it("从各自 store 读取快照并通过 task 写入口更新任务", async () => {
    const stores: DesktopStateStores = {
      batch_translation: createBatchTranslationSnapshotStore(),
      runtime: createRuntimeActivityStore(),
      projectChange: createProjectChangeSignalStore(),
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
      observed.syncTask(
        normalize_batch_translation_snapshot({
          batch_translation: { revision: 1, status: "running" },
        }),
      );
      stores.runtime.applySnapshot({ revision: 2, owner: "agent" });
      stores.projectChange.applySnapshot({
        seq: 3,
        reason: "items_updated",
        updated_sections: ["items"],
        results: [],
      });
    });

    expect(observed.batch_translation).toMatchObject({ revision: 1, status: "running" });
    expect(observed.runtime).toEqual({ revision: 2, owner: "agent" });
    expect(observed.projectChange).toMatchObject({ seq: 3, updated_sections: ["items"] });

    await act(async () => root.unmount());
  });
});

function useDesktopStateProbe() {
  return {
    batch_translation: useBatchTranslationSnapshot(),
    runtime: useRuntimeSnapshot(),
    projectChange: useProjectChangeSignal(),
    syncTask: useSyncBatchTranslationSnapshot(),
  };
}
