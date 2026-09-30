import type { BrowserWindow } from "electron";

type WindowTaskStep = <T>(name: string, run: () => Promise<T>) => Promise<T>;

/** 单次任务独占窗口。窗口销毁后 Electron 的脚本 Promise 可能悬挂，各阶段通过 step 等待。 */
export async function run_window_task<T>(
  window: BrowserWindow,
  signal: AbortSignal,
  timeout_ms: number,
  run: (step: WindowTaskStep) => Promise<T>,
): Promise<T> {
  const lifetime = new AbortController(); // 超时和原生窗口退出共用终止信号
  const combined = AbortSignal.any([signal, lifetime.signal]);
  let stage = "start"; // 异常定位到最后进入的宿主阶段
  const stopped = Promise.withResolvers<never>(); // 结束当前阶段对 Electron 的等待
  /** 保留触发取消的一方提供的原因。 */
  const abort = () => stopped.reject(combined.reason);
  const closed = new Promise<void>((resolve) => {
    window.once("closed", () => {
      lifetime.abort(new Error(`Window closed during ${stage}.`));
      resolve();
    });
  });
  /** renderer 崩溃也必须释放任务，避免后续请求留在队列中。 */
  const crashed = (_event: unknown, details: { reason: string }) => {
    lifetime.abort(new Error(`Renderer exited during ${stage}: ${details.reason}`));
  };
  window.webContents.once("render-process-gone", crashed);
  combined.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () =>
      lifetime.abort(new DOMException(`Window task timed out during ${stage}.`, "TimeoutError")),
    timeout_ms,
  );
  /** 执行前和结果交付前检查取消，防止迟到结果启动后续阶段。 */
  const step: WindowTaskStep = async (name, action) => {
    combined.throwIfAborted();
    stage = name;
    const value = await Promise.race([action(), stopped.promise]);
    combined.throwIfAborted();
    return value;
  };
  try {
    return await run(step);
  } finally {
    clearTimeout(timeout);
    combined.removeEventListener("abort", abort);
    window.webContents.removeListener("render-process-gone", crashed);
    if (!window.isDestroyed()) window.destroy();
    await closed;
  }
}
