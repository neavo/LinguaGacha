import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useConfirmDelay } from "./use-confirm-delay";

it("倒计时在关闭、取消延迟和卸载时释放，重开后重新计时", () => {
  vi.useFakeTimers();
  const root = createRoot(document.createElement("div"));
  let remaining = 0;
  let remaining_timers: number;

  /** 从返回值观察倒计时，StrictMode 同时验证 Effect 重建后的清理。 */
  function Probe(props: { open: boolean; delayed: boolean }) {
    remaining = useConfirmDelay(props.open, props.delayed);
    return null;
  }

  /** 同一实例切换弹窗状态，保留真实的 Effect 生命周期。 */
  function render(open: boolean, delayed = true): void {
    act(() =>
      root.render(createElement(StrictMode, null, createElement(Probe, { open, delayed }))),
    );
  }

  try {
    render(false);
    expect(remaining).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    render(true);
    expect(remaining).toBe(3); // 产品要求确认前等待三秒。
    act(() => vi.advanceTimersByTime(1_000));
    expect(remaining).toBe(2);
    render(false);
    expect(remaining).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    render(true);
    expect(remaining).toBe(3);
    act(() => vi.advanceTimersByTime(3_000));
    expect(remaining).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    render(true, false);
    render(true);
    render(true, false);
    expect(remaining).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    render(true);
  } finally {
    act(() => root.unmount());
    remaining_timers = vi.getTimerCount();
    vi.useRealTimers();
  }
  expect(remaining_timers).toBe(0);
});
