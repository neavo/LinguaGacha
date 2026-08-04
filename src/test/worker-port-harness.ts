import { vi } from "vitest";

export type WorkerPortHarness<TMessage> = {
  postMessage: ReturnType<typeof vi.fn>;
  emit: (message: TMessage) => void;
};

/** 安装 worker 入口测试共用的最小 parentPort，并暴露主线程消息入口。 */
export function install_worker_threads_mock<TMessage>(
  worker_data?: Record<string, unknown>,
): WorkerPortHarness<TMessage> {
  let listener: ((message: TMessage) => void) | null = null;
  const postMessage = vi.fn();
  const worker_threads = {
    parentPort: {
      on: vi.fn((event_name: string, next_listener: (message: TMessage) => void) => {
        if (event_name === "message") listener = next_listener;
      }),
      postMessage,
    },
    ...(worker_data === undefined ? {} : { workerData: worker_data }),
  };

  vi.doMock("node:worker_threads", () => ({
    default: worker_threads,
    ...worker_threads,
  }));

  return {
    postMessage,
    emit: (message) => listener?.(message),
  };
}

/** 等待 worker 入口异步分发与回包完成。 */
export async function flush_worker_microtasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
