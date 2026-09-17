import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { TranslationProgressBadge } from "./translation-progress-badge";

// 观察状态键、计数和单位的绑定，不锁定可编辑的本地化措辞。
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? JSON.stringify({ key, ...values }) : key,
  }),
}));

let container: HTMLDivElement;
let root: Root;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.useRealTimers();
});

it.each(["line", "page"] as const)("按 %s 单位显示计数，零保留、null 省略", async (unit) => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <TooltipProvider delay={0}>
        <TranslationProgressBadge
          unit={unit}
          total={9}
          progress={{
            completion_percent: 33,
            completed_count: 1,
            skipped_count: 2,
            failed_count: unit === "line" ? 0 : null,
            pending_count: 6,
          }}
        />
      </TooltipProvider>,
    ),
  );
  const badge = container.querySelector<HTMLElement>("[tabindex]")!;
  expect(badge.textContent).toBe("33.00%");
  expect(badge.tabIndex).toBe(0);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    badge.focus();
    vi.runAllTimers();
  });
  const tooltip = document.querySelector('[role="tooltip"][data-open]')!;
  const counts = [...tooltip.querySelectorAll("div > span")].map((span) =>
    JSON.parse(span.textContent!),
  );
  expect(counts).toEqual([
    { key: `task_progress.${unit}`, status: "task_progress.translation_skipped", count: "2" },
    ...(unit === "line"
      ? [{ key: "task_progress.line", status: "task_progress.translation_failed", count: "0" }]
      : []),
    { key: `task_progress.${unit}`, status: "task_progress.translation_completed", count: "1" },
    { key: `task_progress.${unit}`, status: "task_progress.translation_pending", count: "6" },
    { key: `task_progress.${unit}`, status: "task_progress.total_lines", count: "9" },
  ]);
});
