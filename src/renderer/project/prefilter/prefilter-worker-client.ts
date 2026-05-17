import type {
  ProjectPrefilterMutationInput,
  ProjectPrefilterMutationOutput,
} from "@/project/prefilter/prefilter-mutation-builder";
import { WorkerClientError } from "@/lib/worker-client-error";

type PendingResolver = {
  resolve: (output: ProjectPrefilterMutationOutput) => void;
  reject: (error: Error) => void;
};

type ProjectPrefilterWorkerResponse = {
  id: number;
  output: ProjectPrefilterMutationOutput;
};

export function createProjectPrefilterClient() {
  let next_request_id = 0;
  let worker: Worker | null = null;
  const pending_requests = new Map<number, PendingResolver>();

  function reject_all(error: Error): void {
    for (const resolver of pending_requests.values()) {
      resolver.reject(error);
    }
    pending_requests.clear();
  }

  function ensure_worker(): Worker {
    if (worker !== null) {
      return worker;
    }

    if (typeof Worker === "undefined") {
      throw new WorkerClientError("unsupported");
    }

    try {
      worker = new Worker(new URL("./prefilter-worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      worker = null;
      throw new WorkerClientError("init_failed");
    }

    worker.addEventListener("message", (event: MessageEvent<ProjectPrefilterWorkerResponse>) => {
      const resolver = pending_requests.get(event.data.id);
      if (resolver === undefined) {
        return;
      }
      pending_requests.delete(event.data.id);
      resolver.resolve(event.data.output);
    });
    worker.addEventListener("error", () => {
      reject_all(new WorkerClientError("execution_failed"));
      worker?.terminate();
      worker = null;
    });
    return worker;
  }

  return {
    async compute(input: ProjectPrefilterMutationInput): Promise<ProjectPrefilterMutationOutput> {
      const runtime_worker = ensure_worker();

      next_request_id += 1;
      const request_id = next_request_id;
      return await new Promise<ProjectPrefilterMutationOutput>((resolve, reject) => {
        pending_requests.set(request_id, { resolve, reject });
        runtime_worker.postMessage({
          id: request_id,
          input,
        });
      });
    },
    dispose(): void {
      reject_all(new WorkerClientError("disposed"));
      worker?.terminate();
      worker = null;
    },
  };
}
