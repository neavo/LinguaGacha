import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchStatsSection } from "./workbench-stats-section";

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("WorkbenchStatsSection", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
  });

  it("用专用名称公开分析统计区并允许切换统计模式", async () => {
    const on_toggle_stats_mode = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <WorkbenchStatsSection
          stats={{
            total_items: 10,
            completed_count: 5,
            failed_count: 1,
            pending_count: 3,
            skipped_count: 1,
            completion_percent: 50,
          }}
          stats_mode="analysis"
          on_toggle_stats_mode={on_toggle_stats_mode}
        />,
      );
    });

    const section = container.querySelector<HTMLElement>(".workbench-page__stats-grid");
    expect(section).toBeInstanceOf(HTMLElement);
    expect(section?.textContent).toContain("task_progress.analysis_completed");
    expect(section?.textContent).not.toContain("task_progress.translation_completed");

    const completed_card = [
      ...(section?.querySelectorAll<HTMLElement>('[role="button"]') ?? []),
    ].find((candidate) => candidate.textContent?.includes("task_progress.analysis_completed"));
    if (completed_card === undefined) {
      throw new Error("缺少可切换的分析完成统计卡片");
    }

    await act(async () => completed_card.click());
    expect(on_toggle_stats_mode).toHaveBeenCalledOnce();
  });
});
