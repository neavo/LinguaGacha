import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { PageLeaveProvider } from "@frontend/app/navigation/page-leave-provider";
import { usePageLeave } from "@frontend/app/navigation/page-leave-context";

describe("当前页面离开前保存", () => {
  it("关闭 Tab 与切换工程只保存相应作用域", async () => {
    const root = createRoot(document.createElement("div"));
    let api!: ReturnType<typeof usePageLeave>;
    function Probe(): null {
      api = usePageLeave();
      return null;
    }
    const save_tab = vi.fn(async () => true);
    const save_other_tab = vi.fn(async () => true);
    const save_other_project = vi.fn(async () => true);
    const save_global = vi.fn(async () => true);
    const scope = { kind: "project", projectId: "first" } as const;
    try {
      await act(async () =>
        root.render(
          <PageLeaveProvider>
            <Probe />
          </PageLeaveProvider>,
        ),
      );
      api.register_before_leave(save_tab, { ...scope, tabId: "custom-prompt" });
      api.register_before_leave(save_other_tab, { ...scope, tabId: "project-knowledge" });
      api.register_before_leave(save_other_project, { ...scope, projectId: "second" });
      api.register_before_leave(save_global);
      await act(async () => {
        expect(await api.prepare_page_leave({ ...scope, tabId: "custom-prompt" })).toBe(true);
      });
      expect(save_tab).toHaveBeenCalledOnce();
      expect(save_other_tab).not.toHaveBeenCalled();
      await act(async () => {
        expect(await api.prepare_page_leave(scope)).toBe(true);
      });
      expect(save_tab).toHaveBeenCalledTimes(2);
      expect(save_other_tab).toHaveBeenCalledOnce();
      expect(save_other_project).not.toHaveBeenCalled();
      expect(save_global).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("等待保存结果，失败保留当前页面，再次保存成功后允许离开", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    let api: ReturnType<typeof usePageLeave> | undefined;
    let finish!: (saved: boolean) => void;
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const save_other = vi.fn(async () => true);
    function Probe(): null {
      api = usePageLeave();
      const { register_before_leave } = api;
      useEffect(() => register_before_leave(save), [register_before_leave]);
      useEffect(() => register_before_leave(save_other), [register_before_leave]);
      return null;
    }
    try {
      await act(async () =>
        root.render(
          <PageLeaveProvider>
            <Probe />
          </PageLeaveProvider>,
        ),
      );
      let leaving!: Promise<boolean>;
      await act(async () => {
        leaving = api!.prepare_page_leave();
      });
      expect(api!.leaving).toBe(true);
      expect(await api!.prepare_page_leave()).toBe(false);
      expect(save).toHaveBeenCalledOnce();
      await act(async () => {
        finish(false);
        expect(await leaving).toBe(false);
      });
      expect(save_other).toHaveBeenCalledOnce();
      expect(api!.leaving).toBe(false);
      await act(async () => {
        leaving = api!.prepare_page_leave();
      });
      await act(async () => {
        finish(true);
        expect(await leaving).toBe(true);
      });
    } finally {
      await act(async () => root.unmount());
    }
  });
});
