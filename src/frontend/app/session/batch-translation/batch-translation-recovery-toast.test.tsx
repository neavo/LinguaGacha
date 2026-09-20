import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { BatchTranslationSnapshot } from "@domain/batch-translation";
import { create_text_resolver } from "@shared/i18n";
import { LocaleContext } from "@frontend/app/locale/locale-context";
import { DesktopStateStoresContext } from "@frontend/app/state/desktop-state-context";
import { createBatchTranslationSnapshotStore } from "@frontend/app/state/batch-translation-snapshot-store";
import { createRuntimeActivityStore } from "@frontend/app/state/runtime-activity-store";
import { createProjectChangeSignalStore } from "@frontend/app/state/project-change-signal-store";
import { BatchTranslationRecoveryToast } from "./batch-translation-recovery-toast";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), dismiss: vi.fn() } }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("恢复提示更新倒计时和次数，恢复与停止解除通知", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const store = createBatchTranslationSnapshotStore();
  const root = createRoot(document.createElement("div"));
  const t = vi.fn(create_text_resolver("zh-CN"));
  // 通过真实快照入口更新，覆盖状态归一和订阅传播。
  const update = async (patch: Partial<BatchTranslationSnapshot>): Promise<void> => {
    await act(async () =>
      store.applySnapshot({
        ...store.getSnapshot(),
        revision: store.getSnapshot().revision + 1,
        ...patch,
      }),
    );
  };
  try {
    await act(async () =>
      root.render(
        <DesktopStateStoresContext.Provider
          value={{
            batch_translation: store,
            runtime: createRuntimeActivityStore(),
            projectChange: createProjectChangeSignalStore(),
          }}
        >
          <LocaleContext.Provider value={{ locale: "zh-CN", t }}>
            <BatchTranslationRecoveryToast />
          </LocaleContext.Provider>
        </DesktopStateStoresContext.Provider>,
      ),
    );
    await update({
      source: "standalone",
      status: "running",
      request_recovery: { retry_count: 0, retry_at: 15_000 },
    });
    const options = vi.mocked(toast.warning).mock.lastCall?.[1];
    expect(options).toMatchObject({
      id: expect.any(String),
      dismissible: false,
      closeButton: false,
      duration: Infinity,
    });
    expect(t).toHaveBeenLastCalledWith("batch_translation.feedback.keys_retry_wait", {
      count: "0",
      seconds: "15",
    });
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(t).toHaveBeenLastCalledWith("batch_translation.feedback.keys_retry_wait", {
      count: "0",
      seconds: "14",
    });
    await act(async () => vi.advanceTimersByTimeAsync(14_000));
    expect(t).toHaveBeenLastCalledWith("batch_translation.feedback.keys_retry_running", {
      count: "0",
      seconds: "0",
    });
    await update({ source: "agent", request_recovery: { retry_count: 1, retry_at: null } });
    expect(t).toHaveBeenLastCalledWith("batch_translation.feedback.keys_retry_running", {
      count: "1",
      seconds: "0",
    });
    expect(toast.warning).toHaveBeenLastCalledWith(expect.any(String), options);
    expect(vi.getTimerCount()).toBe(0);
    await update({ request_recovery: null });
    expect(toast.dismiss).toHaveBeenLastCalledWith(options?.id);
    await update({ request_recovery: { retry_count: 0, retry_at: 30_000 } });
    await update({ status: "stopping" });
    expect(toast.dismiss).toHaveBeenLastCalledWith(options?.id);
    vi.mocked(toast.warning).mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(toast.warning).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await act(async () => root.unmount());
  }
});
