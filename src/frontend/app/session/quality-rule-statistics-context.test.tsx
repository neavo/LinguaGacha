import { act, type JSX } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createQualityRuleStatisticsStore } from "./quality-rule-statistics-store";
import { useQualityRuleStatistics } from "./quality-rule-statistics-context";

const fixture = vi.hoisted(() => ({
  status: "ready" as "idle" | "warming" | "ready",
  active: null as { qualityStatistics: ReturnType<typeof createQualityRuleStatisticsStore> } | null,
}));

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({
    active_project: fixture.active ?? undefined,
    project_snapshot: { loaded: fixture.active !== null, path: "E:/demo.lg" },
    project_session_status: fixture.status,
  }),
}));

function Probe(): JSX.Element {
  const snapshot = useQualityRuleStatistics("glossary");
  return <output>{`${snapshot.phase}:${snapshot.hits_by_entry_id["a"] ?? 0}`}</output>;
}

describe("useQualityRuleStatistics", () => {
  it("按当前工程 Store 订阅并补算，切换工程互不串扰", async () => {
    const first_fetch = vi.fn(async () => ({
      projectPath: "E:/first.lg",
      statistics: {
        phase: "current" as const,
        entry_ids: ["a"],
        hits_by_entry_id: { a: 2 },
        subset_parents_by_entry_id: {},
        last_error: null,
      },
    }));
    const second_fetch = vi.fn(async () => ({
      projectPath: "E:/second.lg",
      statistics: {
        phase: "current" as const,
        entry_ids: ["a"],
        hits_by_entry_id: { a: 5 },
        subset_parents_by_entry_id: {},
        last_error: null,
      },
    }));
    const first = createQualityRuleStatisticsStore(first_fetch);
    first.reset("E:/first.lg");
    const second = createQualityRuleStatisticsStore(second_fetch);
    second.reset("E:/second.lg");

    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      fixture.status = "warming";
      fixture.active = { qualityStatistics: first };
      await act(async () => root.render(<Probe />));
      expect(first_fetch).not.toHaveBeenCalled();

      fixture.status = "ready";
      await act(async () => root.render(<Probe />));
      expect(first_fetch).toHaveBeenCalledWith("glossary");
      expect(container.textContent).toBe("current:2");

      fixture.active = { qualityStatistics: second };
      await act(async () => root.render(<Probe />));
      expect(second_fetch).toHaveBeenCalledWith("glossary");
      expect(container.textContent).toBe("current:5");

      fixture.active = { qualityStatistics: first };
      await act(async () => root.render(<Probe />));
      expect(container.textContent).toBe("current:2");
      expect(first_fetch).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
