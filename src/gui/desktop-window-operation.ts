import type { BrowserWindow } from "electron";

/** 一次性窗口操作在取消时主动结束等待，并在所有终态统一销毁窗口。 */
export async function run_abortable_window_operation<T>(
  target_window: BrowserWindow,
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> {
  let reject_abort!: (reason?: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    reject_abort = reject;
  });
  const abort = () => {
    reject_abort(signal.reason);
    if (!target_window.isDestroyed()) target_window.destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) {
      abort();
      return await aborted;
    }
    return await Promise.race([operation(), aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
    if (!target_window.isDestroyed()) target_window.destroy();
  }
}
