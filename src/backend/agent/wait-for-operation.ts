import { addAbortListener } from "node:events";

/** 取消本次等待，共享操作仍由其拥有者结算。 */
export async function wait_for_operation<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  const cancelled = Promise.withResolvers<never>();
  const listener = addAbortListener(signal, () => cancelled.reject(signal.reason));
  try {
    const value = await Promise.race([work, cancelled.promise]);
    signal.throwIfAborted();
    return value;
  } finally {
    listener[Symbol.dispose]();
  }
}
