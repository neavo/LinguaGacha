import crypto from "node:crypto";
import { parentPort, workerData, type MessagePort } from "node:worker_threads";

import { normalize_log_error, to_log_error } from "../../../shared/error";
import type { LLMClientPort, LLMRequestBody, LLMRequestResult } from "../../llm/llm-types";
import { WorkUnitRunner, type WorkUnitRunnerOptions } from "./work-unit-runner";
import type { WorkUnitWorkerCommand, WorkUnitWorkerEvent } from "./work-unit-worker-protocol";

type WorkUnitWorkerData = Pick<WorkUnitRunnerOptions, "builtinRoot">;

/** worker 只通过结构化请求访问父线程 LLMClient，不持有供应商网络能力。 */
class WorkerLLMClient implements LLMClientPort {
  private readonly port: MessagePort; // 父线程拥有真实 LLMClient 与网络生命周期
  /** request id 隔离同一 worker 内的并发模型请求。 */
  private readonly pending = new Map<
    string,
    { resolve: (value: LLMRequestResult) => void; reject: (error: unknown) => void }
  >();

  /** 绑定当前 worker 的唯一父线程端口。 */
  public constructor(port: MessagePort) {
    this.port = port;
  }

  /** 发送中性请求体；真正的取消信号由父线程对应 work unit 持有。 */
  public request(body: LLMRequestBody, _signal: AbortSignal): Promise<LLMRequestResult> {
    return new Promise((resolve, reject) => {
      const request_id = crypto.randomUUID();
      this.pending.set(request_id, { resolve, reject });
      this.port.postMessage({
        type: "llm_request",
        requestId: request_id,
        body,
      } satisfies WorkUnitWorkerEvent);
    });
  }

  /** 按 request id 结算一次模型请求，未知或迟到结果不影响其它请求。 */
  public settle(message: Extract<WorkUnitWorkerCommand, { type: "llm_result" }>): void {
    const request = this.pending.get(message.requestId);
    if (request === undefined) return;
    this.pending.delete(message.requestId);
    if (message.result.ok) request.resolve(message.result.data);
    else
      request.reject(
        new Error(normalize_log_error(message.result.error, "LLM request failed.").message),
      );
  }
}

/**
 * work unit worker_threads 入口，只处理消息、取消和结果回传，不承载业务逻辑
 */
class WorkUnitWorkerEntry {
  private readonly port: MessagePort; // 所有结果回到创建当前 entry 的父线程
  private readonly runner: WorkUnitRunner; // 持有提示词、pipeline 与响应处理
  private readonly llm_client: WorkerLLMClient; // 将 runner 模型请求转发到父线程
  private readonly controllers = new Map<string, AbortController>(); // 按消息 id 保存，允许主线程只取消指定 work unit

  /**
   * workerData 由 WorkUnitWorkerPool 注入，只包含 work unit 需要的资源根
   */
  public constructor(options: WorkUnitWorkerData, port: MessagePort) {
    this.port = port;
    this.llm_client = new WorkerLLMClient(port);
    this.runner = new WorkUnitRunner({ ...options, llmClient: this.llm_client });
  }

  /**
   * 收到 execute 执行 work unit，收到 cancel 只中断对应 AbortController
   */
  public handle_message(message: WorkUnitWorkerCommand): void {
    if (message.type === "llm_result") {
      this.llm_client.settle(message);
      return;
    }
    if (message.type === "cancel") {
      this.controllers.get(message.id)?.abort();
      return;
    }
    void this.run_message(message);
  }

  /**
   * 每条消息独立 AbortController，迟到结果由 TaskEngine 的 run_id 再隔离
   */
  private async run_message(
    message: Extract<WorkUnitWorkerCommand, { type: "execute" }>,
  ): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(message.id, controller);
    try {
      const data = await this.runner.run(message.unit, controller.signal);
      this.port.postMessage({
        type: "result",
        id: message.id,
        result: { ok: true, data },
      } satisfies WorkUnitWorkerEvent);
    } catch (error) {
      this.port.postMessage({
        type: "result",
        id: message.id,
        result: {
          ok: false,
          error: to_log_error(error, { worker_message_type: message.type }),
        },
      } satisfies WorkUnitWorkerEvent);
    } finally {
      this.controllers.delete(message.id);
    }
  }
}

const worker_data = workerData as WorkUnitWorkerData; // 只包含可结构化克隆的启动事实
if (parentPort === null) throw new Error("Work unit worker requires parentPort.");
const entry = new WorkUnitWorkerEntry(worker_data, parentPort); // 顶层入口必须立即绑定 parentPort，worker_threads 加载后即可接收池派发消息
parentPort.on("message", (message: WorkUnitWorkerCommand) => entry.handle_message(message));
