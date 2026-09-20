import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import * as notifications from "./desktop-toast";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), dismiss: vi.fn(), getToasts: () => [] },
}));

beforeEach(() => vi.useFakeTimers());
it("持续警告指定无限展示时长并支持显式关闭", () => {
  vi.mocked(toast.warning).mockReturnValue("warning");
  const id = notifications.push_toast("warning", "部分条目失败", { persistent: true });
  expect(toast.warning).toHaveBeenCalledWith("部分条目失败", {
    duration: Infinity,
  });
  vi.mocked(toast.dismiss).mockClear();
  notifications.dismiss_toast(id);
  expect(toast.dismiss).toHaveBeenCalledWith("warning");
});
afterEach(async () => {
  notifications.dismiss_toast();
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});

it("恢复动作持续可用并交给通知展示层", () => {
  const action = { label: "撤销", onClick: vi.fn() };
  notifications.push_toast("error", "保存失败", { action });
  expect(toast.error).toHaveBeenCalledWith("保存失败", {
    action,
    duration: Number.POSITIVE_INFINITY,
  });
});

it("接管进度后，旧任务与关闭计时不能改写当前快照", async () => {
  const previous = notifications.push_progress_toast({ message: "旧任务" });
  notifications.dismiss_toast(previous);
  const current = notifications.push_progress_toast({ message: "当前任务", presentation: "modal" });
  const snapshot = notifications.read_progress_toast();
  notifications.update_progress_toast(previous, { message: "迟到更新" });
  expect(notifications.read_progress_toast()).toBe(snapshot);
  notifications.dismiss_toast(previous);
  await vi.runOnlyPendingTimersAsync();
  expect(notifications.read_progress_toast()).toBe(snapshot);
  notifications.update_progress_toast(current, {
    message: "当前进度",
    progress_percent: 80,
    presentation: "modal",
  });
  expect(notifications.read_progress_toast()).toMatchObject({
    message: "当前进度",
    progress_percent: 80,
  });
  notifications.dismiss_toast(current);
  expect(notifications.read_progress_toast()).toBeNull();
});

it("模态任务超时后回传错误并释放当前进度", async () => {
  const pending = notifications.run_modal_progress_toast({
    message: "处理中",
    task: () => new Promise<never>(() => undefined),
    timeout_ms: 100,
  });
  const rejection = expect(pending).rejects.toBeInstanceOf(
    notifications.ModalProgressToastTimeoutError,
  );
  await vi.advanceTimersByTimeAsync(100);
  await rejection;
  expect(notifications.read_progress_toast()).toBeNull();
});
