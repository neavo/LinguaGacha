import { afterEach, describe, expect, it, vi } from "vitest";

import {
  flush_worker_microtasks,
  install_worker_threads_mock,
} from "../../../test/worker-port-harness";
import type { LLMClientPort } from "../../llm/llm-types";
import type { WorkUnitWorkerCommand } from "./work-unit-worker-protocol";

type RunnerMock = { run: ReturnType<typeof vi.fn> };

const TEST_BUILTIN_ROOT = "E:/linguagacha-work-unit-test/builtin";

function install_runner_mock(
  runner: RunnerMock,
  read_llm_client?: (client: LLMClientPort) => void,
): void {
  vi.doMock("./work-unit-runner", () => {
    /** 只替换入口的业务协作者，消息分发仍运行生产实现。 */
    class WorkUnitRunnerMock {
      public run = runner.run;

      public constructor(options: { llmClient: LLMClientPort }) {
        read_llm_client?.(options.llmClient);
      }
    }

    return { WorkUnitRunner: WorkUnitRunnerMock };
  });
}

async function import_worker_entry(): Promise<void> {
  await import("./work-unit-worker-entry");
}

describe("work-unit-worker-entry", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:worker_threads");
    vi.doUnmock("./work-unit-runner");
  });

  it("execute 结果使用统一终态 envelope 回传", async () => {
    const harness = install_worker_threads_mock<WorkUnitWorkerCommand>({
      builtinRoot: TEST_BUILTIN_ROOT,
    });
    const runner = { run: vi.fn(async () => ({ outcome: "completed" })) };
    install_runner_mock(runner);

    await import_worker_entry();
    harness.emit({
      id: "work-1",
      type: "execute",
      unit: { kind: "translation" } as never,
    });
    await flush_worker_microtasks();

    expect(runner.run).toHaveBeenCalledWith({ kind: "translation" }, expect.any(AbortSignal));
    expect(harness.postMessage).toHaveBeenCalledWith({
      type: "result",
      id: "work-1",
      result: { ok: true, data: { outcome: "completed" } },
    });
  });

  it("worker LLMClientPort 通过父线程请求并按 request id 结算", async () => {
    const harness = install_worker_threads_mock<WorkUnitWorkerCommand>({
      builtinRoot: TEST_BUILTIN_ROOT,
    });
    const llm_clients: LLMClientPort[] = [];
    install_runner_mock({ run: vi.fn() }, (client) => {
      llm_clients.push(client);
    });
    await import_worker_entry();
    const llm_client = llm_clients[0];
    if (llm_client === undefined) throw new Error("worker 未向 runner 注入 LLMClientPort");

    const body = {
      run_id: "run-1",
      work_unit_id: "unit-1",
      model: {},
      config_snapshot: {},
      messages: [{ role: "user" as const, content: "test" }],
    };
    const request = llm_client.request(body, new AbortController().signal);
    const posted = harness.postMessage.mock.calls[0]?.[0] as {
      type: "llm_request";
      requestId: string;
      body: unknown;
    };
    expect(posted).toMatchObject({ type: "llm_request", body });

    harness.emit({
      type: "llm_result",
      requestId: posted.requestId,
      result: {
        ok: true,
        data: {
          response_think: "",
          response_result: "ok",
          input_tokens: 1,
          reasoning_tokens: 0,
          output_tokens: 2,
          cancelled: false,
          timeout: false,
        },
      },
    });

    await expect(request).resolves.toMatchObject({ response_result: "ok" });
  });

  it("cancel 只中断同 id 的运行中消息", async () => {
    const harness = install_worker_threads_mock<WorkUnitWorkerCommand>({
      builtinRoot: TEST_BUILTIN_ROOT,
    });
    const run_state: {
      signal: AbortSignal | null;
      resolve: ((value: unknown) => void) | null;
    } = { signal: null, resolve: null };
    install_runner_mock({
      run: vi.fn(
        (_unit: unknown, signal: AbortSignal) =>
          new Promise((resolve) => {
            run_state.signal = signal;
            run_state.resolve = resolve;
          }),
      ),
    });

    await import_worker_entry();
    harness.emit({ id: "work-2", type: "execute", unit: { kind: "analysis" } as never });
    await flush_worker_microtasks();
    harness.emit({ id: "work-2", type: "cancel" });

    expect(run_state.signal?.aborted).toBe(true);
    run_state.resolve?.({ outcome: "cancelled-after-test" });
    await flush_worker_microtasks();

    expect(harness.postMessage).toHaveBeenCalledWith({
      type: "result",
      id: "work-2",
      result: { ok: true, data: { outcome: "cancelled-after-test" } },
    });
  });
});
