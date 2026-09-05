import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { PageLeaveProvider, usePageLeave } from "./page-leave-context";

describe("当前页面离开前保存", () => {
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
    function Probe(): null {
      api = usePageLeave();
      const { register_before_leave } = api;
      useEffect(() => register_before_leave(save), [register_before_leave]);
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
