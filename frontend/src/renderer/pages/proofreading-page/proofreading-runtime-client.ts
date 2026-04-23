import type { ProofreadingSnapshot } from "@/pages/proofreading-page/types";
import { type ProofreadingRuntimeInput } from "@/pages/proofreading-page/proofreading-runtime";
import { WorkerClientError } from "@/lib/worker-client-error";

type PendingResolver = {
  resolve: (snapshot: ProofreadingSnapshot) => void;
  reject: (error: Error) => void;
};

type ProofreadingRuntimeWorkerResponse = {
  id: number;
  snapshot: ProofreadingSnapshot;
};

export function createProofreadingRuntimeClient() {
  let next_request_id = 0;
  let worker: Worker | null = null;
  const pending_requests = new Map<number, PendingResolver>();

  function rejectAll(error: Error): void {
    for (const resolver of pending_requests.values()) {
      resolver.reject(error);
    }
    pending_requests.clear();
  }

  function ensureWorker(): Worker {
    if (worker !== null) {
      return worker;
    }

    if (typeof Worker === "undefined") {
      throw new WorkerClientError("当前环境不支持 proofreading runtime worker。", "unsupported");
    }

    try {
      worker = new Worker(new URL("./proofreading-runtime-worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      worker = null;
      throw new WorkerClientError("proofreading runtime worker 初始化失败。", "init_failed");
    }

    worker.addEventListener("message", (event: MessageEvent<ProofreadingRuntimeWorkerResponse>) => {
      const resolver = pending_requests.get(event.data.id);
      if (resolver === undefined) {
        return;
      }
      pending_requests.delete(event.data.id);
      resolver.resolve(event.data.snapshot);
    });
    worker.addEventListener("error", () => {
      rejectAll(
        new WorkerClientError("proofreading runtime worker 执行失败。", "execution_failed"),
      );
      worker?.terminate();
      worker = null;
    });
    return worker;
  }

  return {
    async compute(input: ProofreadingRuntimeInput): Promise<ProofreadingSnapshot> {
      const runtime_worker = ensureWorker();

      next_request_id += 1;
      const request_id = next_request_id;
      return await new Promise<ProofreadingSnapshot>((resolve, reject) => {
        pending_requests.set(request_id, { resolve, reject });
        runtime_worker.postMessage({
          id: request_id,
          input,
        });
      });
    },
    dispose(): void {
      rejectAll(new WorkerClientError("proofreading runtime worker 已释放。", "disposed"));
      worker?.terminate();
      worker = null;
    },
  };
}
