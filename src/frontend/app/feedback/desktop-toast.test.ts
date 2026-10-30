import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import * as notifications from "./desktop-toast";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), dismiss: vi.fn(), getToasts: () => [] },
}));

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  notifications.dismiss_toast();
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

it("持续警告透传结果正文并支持显式关闭", () => {
  vi.mocked(toast.warning).mockReturnValue("warning");
  const id = notifications.push_toast("warning", "部分条目失败", {
    persistent: true,
    description: "未匹配 2 条",
  });
  expect(toast.warning).toHaveBeenCalledWith("部分条目失败", {
    duration: Infinity,
    description: "未匹配 2 条",
  });
  vi.mocked(toast.dismiss).mockClear();
  notifications.dismiss_toast(id);
  expect(toast.dismiss).toHaveBeenCalledWith("warning");
});

it("恢复动作持续可用并交给通知展示层", () => {
  const action = { label: "撤销", onClick: vi.fn() };
  notifications.push_error_toast("保存失败 …", new Error("disk full"), { action });
  expect(toast.error).toHaveBeenCalledWith("保存失败 …", {
    action,
    description: "disk full",
    duration: Number.POSITIVE_INFINITY,
  });
});

it("接管进度后，旧任务与关闭计时不能结束当前任务", async () => {
  const previous = notifications.push_progress_toast({ message: "旧任务" });
  notifications.dismiss_toast(previous);
  const current = notifications.push_progress_toast({ message: "当前任务", presentation: "modal" });
  notifications.dismiss_toast(previous);
  await vi.advanceTimersByTimeAsync(2000);
  expect(notifications.read_progress_toast()).toMatchObject({
    owner_token: current,
  });
  notifications.dismiss_toast(current);
  expect(notifications.read_progress_toast()).toBeNull();
});

it("短模态任务立即返回结果，结束后不会再弹出提示", async () => {
  await expect(
    notifications.run_modal_progress_toast({ message: "处理中", task: async () => "完成" }),
  ).resolves.toBe("完成");
  expect(notifications.read_progress_toast()).toBeNull();
  await vi.advanceTimersByTimeAsync(250);
  expect(notifications.read_progress_toast()).toBeNull();
});

it("模态提示延迟 250ms 展示，重复关闭仍从展示时刻保留一秒", async () => {
  const id = notifications.push_progress_toast({ message: "处理中", presentation: "modal" });
  expect(notifications.read_progress_toast()).toMatchObject({ shown_at: null });
  await vi.advanceTimersByTimeAsync(249);
  expect(notifications.read_progress_toast()).toMatchObject({ shown_at: null });
  await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(50);
  notifications.dismiss_toast(id);
  await vi.advanceTimersByTimeAsync(500);
  notifications.dismiss_toast(id);
  await vi.advanceTimersByTimeAsync(449);
  expect(notifications.read_progress_toast()).not.toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  expect(notifications.read_progress_toast()).toBeNull();
});

it("连续模态任务保持展示，旧任务的关闭计时不能关闭接管者", async () => {
  const previous = notifications.push_progress_toast({ message: "旧任务", presentation: "modal" });
  await vi.advanceTimersByTimeAsync(250);
  const shown_at = notifications.read_progress_toast()?.shown_at;
  notifications.dismiss_toast(previous);
  await vi.advanceTimersByTimeAsync(100);
  const current = notifications.push_progress_toast({ message: "当前任务", presentation: "modal" });
  expect(notifications.read_progress_toast()).toMatchObject({ owner_token: current, shown_at });
  notifications.dismiss_toast(previous);
  await vi.advanceTimersByTimeAsync(1000);
  expect(notifications.read_progress_toast()).toMatchObject({ owner_token: current, shown_at });
  notifications.dismiss_toast(current);
  expect(notifications.read_progress_toast()).toBeNull();
});

it.each([100, 400])("模态任务在 %ims 超时后立即回传错误，展示按时序收尾", async (timeout_ms) => {
  const pending = notifications.run_modal_progress_toast({
    message: "处理中",
    task: () => new Promise<never>(() => undefined),
    timeout_ms,
  });
  const rejection = expect(pending).rejects.toBeInstanceOf(
    notifications.ModalProgressToastTimeoutError,
  );
  await vi.advanceTimersByTimeAsync(timeout_ms);
  await rejection;
  if (timeout_ms > 250) {
    expect(notifications.read_progress_toast()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1250 - timeout_ms);
  }
  expect(notifications.read_progress_toast()).toBeNull();
});
