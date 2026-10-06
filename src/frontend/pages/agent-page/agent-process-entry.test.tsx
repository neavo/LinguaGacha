import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentContextCompactionEntry as CompactionEntry } from "@shared/agent";
import { AgentContextCompactionEntry } from "./agent-process-entry";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

it("压缩耗时沿用后端起始时间，重挂载可恢复，新任务重新计时，终态释放时钟", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(105_000);
  const render_compaction = (entry: CompactionEntry) =>
    render_entry(
      <AgentContextCompactionEntry
        key={entry.id}
        entry={entry}
        latest
        compact_available
        on_compact={vi.fn()}
      />,
    );
  const running: CompactionEntry = {
    kind: "context_compaction",
    id: "compact",
    status: "running",
    createdAt: 100_000,
  };
  const view = await render_compaction(running);
  const duration = () => view.querySelector(".agent-process-entry__elapsed")?.textContent;
  expect(duration()).toBe(" · 5s");
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(duration()).toBe(" · 7s");
  await render_compaction({ ...running, id: "remounted" });
  expect(duration()).toBe(" · 7s");
  await render_compaction({ ...running, id: "retry", createdAt: 107_000 });
  expect(duration()).toBe(" · 0s");
  await render_compaction({ ...running, status: "success" });
  expect(duration()).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
  await render_compaction({ ...running, createdAt: null });
  expect(duration()).toBeUndefined();
});

/** 复用挂载点观察状态切换与原生按钮行为，卸载由用例清理负责。 */
async function render_entry(children: ReactNode): Promise<HTMLDivElement> {
  if (container === null) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root?.render(children));
  return container;
}

it("最新失败压缩整行重试，禁用时收起提示，其它记录和状态退出恢复入口", async () => {
  const old: CompactionEntry = {
    kind: "context_compaction",
    createdAt: null,
    id: "old",
    status: "error",
  };
  const failed: CompactionEntry = {
    kind: "context_compaction",
    createdAt: null,
    id: "failed",
    status: "error",
  };
  const on_compact = vi.fn();
  /** 最近压缩身份由调用方提供，状态与可用性分别控制入口显示和启用。 */
  const render_compactions = (entry: CompactionEntry, available: boolean) =>
    render_entry(
      <>
        <AgentContextCompactionEntry
          entry={old}
          latest={false}
          compact_available={available}
          on_compact={on_compact}
        />
        <AgentContextCompactionEntry
          entry={entry}
          latest
          compact_available={available}
          on_compact={on_compact}
        />
      </>,
    );
  const view = await render_compactions(failed, true);
  expect(view.querySelectorAll("button")).toHaveLength(1);
  const retry = view.querySelector<HTMLButtonElement>("button");
  const retry_label = retry?.textContent;
  expect(retry?.getAttribute("aria-label")).toBe(retry_label);
  await act(async () => retry?.click());
  expect(on_compact).toHaveBeenCalledOnce();
  await render_compactions(failed, false);
  expect(retry?.disabled).toBe(true);
  expect(retry?.textContent).not.toBe(retry_label);
  await act(async () => retry?.click());
  expect(on_compact).toHaveBeenCalledOnce();
  await render_compactions(failed, true);
  expect(retry?.disabled).toBe(false);
  expect(retry?.textContent).toBe(retry_label);
  await act(async () => retry?.querySelector<HTMLElement>('[role="status"]')?.click());
  expect(on_compact).toHaveBeenCalledTimes(2);
  for (const status of ["running", "success", "stopped"] as const) {
    await render_compactions({ ...failed, status }, true);
    expect(view.querySelector("button")).toBeNull();
  }
});
