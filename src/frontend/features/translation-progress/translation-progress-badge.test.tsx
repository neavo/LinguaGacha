import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { create_text_resolver } from "@shared/i18n";
import {
  build_project_translation_stats,
  type ProjectTranslationStats,
} from "@shared/project-translation-stats";
import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { TranslationProgressBadge } from "./translation-progress-badge";

it("按完成率显示进度，并在胶囊获得焦点时展示各类条目数", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const render = (progress: ProjectTranslationStats) =>
    act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <TooltipProvider>
            <TranslationProgressBadge progress={progress} tabIndex={0} />
          </TooltipProvider>
        </LocaleProvider>,
      ),
    );

  try {
    await render(build_project_translation_stats([]));
    const badge = host.querySelector<HTMLElement>(".app-badge")!;
    expect(badge.textContent).toBe("0.00%");

    await render({
      total_items: 100,
      completed_count: 97,
      pending_count: 1,
      skipped_count: 2,
      completion_percent: 99,
    });
    expect(badge.textContent).toBe("99.00%");
    expect(badge.dataset.tone).toBe("neutral");

    await act(async () => badge.focus());
    const tooltip = document.querySelector('[role="tooltip"][data-open]');
    const t = create_text_resolver("zh-CN");
    for (const [status, count] of [
      ["task_progress.translation_skipped", "2"],
      ["task_progress.translation_completed", "97"],
      ["task_progress.translation_pending", "1"],
      ["task_progress.total_lines", "100"],
    ] as const) {
      expect(tooltip?.textContent).toContain(t("task_progress.line", { status: t(status), count }));
    }

    await render({
      total_items: 100,
      completed_count: 98,
      pending_count: 0,
      skipped_count: 2,
      completion_percent: 100,
    });
    expect(badge.textContent).toBe("100.00%");
    expect(badge.dataset.tone).toBe("success");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
