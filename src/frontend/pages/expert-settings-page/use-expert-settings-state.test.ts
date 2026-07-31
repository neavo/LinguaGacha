import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExpertSettingsSnapshot } from "./types";
import { useExpertSettingsState } from "./use-expert-settings-state";

const commit_update = vi.fn(async () => null);
const runtime = {
  owner: null as "task" | "agent" | null,
};
const snapshot: ExpertSettingsSnapshot = {
  preceding_lines_threshold: 3,
  clean_ruby: false,
  deduplication_in_bilingual: false,
  write_translated_name_fields_to_file: false,
  auto_process_prefix_suffix_preserved_text: false,
};

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    runtime_snapshot: runtime,
  }),
  useRuntimeSnapshot: () => runtime,
}));

vi.mock("@frontend/features/settings-editor/use-settings-editor", () => ({
  useSettingsEditor: () => ({
    snapshot,
    pending_state: {
      preceding_lines_threshold: false,
      clean_ruby: false,
      deduplication_in_bilingual: false,
      write_translated_name_fields_to_file: false,
      auto_process_prefix_suffix_preserved_text: false,
    },
    commit_update,
  }),
}));

describe("useExpertSettingsState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useExpertSettingsState> | null = null;

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
    runtime.owner = null;
    commit_update.mockClear();
  });

  function Probe(): null {
    latest_state = useExpertSettingsState();
    return null;
  }

  async function render_hook(): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => {
      root?.render(createElement(Probe));
    });
  }

  it("在页面边界归一化阈值后提交", async () => {
    await render_hook();

    await act(async () => {
      await latest_state?.update_preceding_lines_threshold(-1);
    });

    expect(commit_update).toHaveBeenCalledWith("preceding_lines_threshold", {
      preceding_lines_threshold: 0,
    });
  });

  it("项目写锁生效时不提交设置", async () => {
    runtime.owner = "agent";
    await render_hook();

    await act(async () => {
      await latest_state?.update_clean_ruby(true);
    });

    expect(latest_state?.runtime_locked).toBe(true);
    expect(commit_update).not.toHaveBeenCalled();
  });
});
