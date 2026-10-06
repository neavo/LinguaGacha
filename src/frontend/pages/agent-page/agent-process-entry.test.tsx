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

it("最新失败压缩提供重试，旧记录和运行或成功状态退出恢复入口", async () => {
  const old: CompactionEntry = { kind: "context_compaction", id: "old", status: "error" };
  const failed: CompactionEntry = { kind: "context_compaction", id: "failed", status: "error" };
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
  await act(async () => retry?.click());
  expect(on_compact).toHaveBeenCalledOnce();
  await render_compactions(failed, false);
  expect(retry?.disabled).toBe(true);
  await act(async () => retry?.click());
  expect(on_compact).toHaveBeenCalledOnce();
  for (const status of ["running", "success"] as const) {
    await render_compactions({ ...failed, status }, true);
    expect(view.querySelector("button")).toBeNull();
  }
});
