/**
 * 等待异步结果，并在 signal 中止时立即以中止原因结束。
 *
 * 用于自身不支持 AbortSignal 的调用（如 Electron `session.resolveProxy`），
 * 让路由解析与后续请求共享同一个超时上限。
 */
export function race_abort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const on_abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", on_abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", on_abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", on_abort);
        reject(error);
      },
    );
  });
}
