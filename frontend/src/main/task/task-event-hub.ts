import type { LogManager } from "../log/log-manager";
import type { ApiJsonValue } from "../api/api-types";
import { ProjectPatchAdapter } from "../project/project-patch-adapter";
import { JsonTool } from "../../shared/utils/json-tool";
import { TaskRuntimeState } from "./task-runtime-state";
import type { JsonRecord } from "./task-types";

// 上游断线后的重连间隔保持短但不过度刷屏，适合本机进程间 SSE。
const UPSTREAM_RECONNECT_DELAY_MS = 1000;

// 公开事件流 keepalive 仍由 TS 发出，renderer 不需要感知上游是否短暂重连。
const KEEPALIVE_INTERVAL_MS = 500;

interface TaskEventHubOptions {
  pyCoreBaseUrl: string;
  projectPatchAdapter: ProjectPatchAdapter;
  taskRuntimeState: TaskRuntimeState;
  logManager: LogManager;
}

interface HubSubscriber {
  enqueue: (text: string) => void;
  close: () => void;
}

/**
 * TS Gateway 事件 hub：单连接消费 Python 上游，再广播公开 SSE 与本地 TS 事件。
 */
export class TaskEventHub {
  private readonly py_core_base_url: string;

  private readonly project_patch_adapter: ProjectPatchAdapter;

  private readonly task_runtime_state: TaskRuntimeState;

  private readonly log_manager: LogManager;

  private readonly subscribers = new Set<HubSubscriber>();

  private upstream_abort_controller: AbortController | null = null;

  private started = false;

  private stopping = false;

  /**
   * 事件 hub 只保存 main 进程内部依赖，不向 preload/renderer 暴露上游地址。
   */
  public constructor(options: TaskEventHubOptions) {
    this.py_core_base_url = options.pyCoreBaseUrl;
    this.project_patch_adapter = options.projectPatchAdapter;
    this.task_runtime_state = options.taskRuntimeState;
    this.log_manager = options.logManager;
  }

  /**
   * 启动单一 Python 上游订阅；没有 renderer 订阅时也保持消费终态事件。
   */
  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    void this.consume_upstream_loop();
  }

  /**
   * Gateway 停止时主动中断上游和订阅者，避免测试或重启泄漏长连接。
   */
  public stop(): void {
    this.stopping = true;
    this.upstream_abort_controller?.abort();
    this.upstream_abort_controller = null;
    for (const subscriber of this.subscribers) {
      subscriber.close();
    }
    this.subscribers.clear();
  }

  /**
   * 本地 TS 服务发布设置或项目补丁时，也走同一条广播和运行态吸收路径。
   */
  public publish(event_type: string, payload: JsonRecord): void {
    this.apply_runtime_state(event_type, payload);
    this.broadcast(this.build_sse_frame(event_type, payload));
  }

  /**
   * project.patch 发布前先补全数据库运行态，保证本地和上游 patch 语义一致。
   */
  public publish_project_patch(payload: JsonRecord): void {
    this.publish("project.patch", this.project_patch_adapter.adapt_project_patch(payload));
  }

  /**
   * 为公开 `/api/events/stream` 创建订阅响应，订阅者只连接 TS Gateway。
   */
  public create_stream_response(): Response {
    const encoder = new TextEncoder();
    let keepalive_timer: ReturnType<typeof setInterval> | null = null;
    let subscriber: HubSubscriber | null = null;
    let closed = false;
    const remove_subscriber = (): void => {
      if (keepalive_timer !== null) {
        clearInterval(keepalive_timer);
        keepalive_timer = null;
      }
      if (subscriber !== null) {
        this.subscribers.delete(subscriber);
        subscriber = null;
      }
    };
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        subscriber = {
          enqueue: (text) => {
            if (closed) {
              return;
            }
            try {
              controller.enqueue(encoder.encode(text));
            } catch {
              // 下游 reader 可能已经取消；订阅已失效，移除即可避免后续 keepalive 重复写入。
              closed = true;
              remove_subscriber();
            }
          },
          close: () => {
            if (closed) {
              return;
            }
            closed = true;
            remove_subscriber();
            try {
              controller.close();
            } catch {
              // ReadableStream 可能已被下游关闭；Gateway 停止时重复 close 是无害清理。
            }
          },
        };
        this.subscribers.add(subscriber);
        keepalive_timer = setInterval(() => {
          subscriber?.enqueue(": keepalive\n\n");
        }, KEEPALIVE_INTERVAL_MS);
      },
      cancel: () => {
        closed = true;
        remove_subscriber();
      },
    });
    return new Response(stream, {
      headers: {
        "Access-Control-Allow-Headers": "Content-Type, X-LinguaGacha-Core-Token",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
      },
      status: 200,
    });
  }

  /**
   * 循环连接 Python 内部 SSE，上游短暂失败只记录日志并继续重试。
   */
  private async consume_upstream_loop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.consume_upstream_once();
      } catch (error) {
        if (!this.stopping) {
          this.log_manager.warning("TS Gateway 事件上游断开，准备重连。", {
            source: "ts-event-hub",
            error_message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      }
      if (!this.stopping) {
        await this.delay(UPSTREAM_RECONNECT_DELAY_MS);
      }
    }
  }

  /**
   * 读取一次 Python SSE 响应并按 frame 分发；解析失败的 frame 会被忽略。
   */
  private async consume_upstream_once(): Promise<void> {
    const abort_controller = new AbortController();
    this.upstream_abort_controller = abort_controller;
    const response = await fetch(`${this.py_core_base_url}/api/events/stream`, {
      method: "GET",
      signal: abort_controller.signal,
    });
    const body = response.body;
    if (body === null) {
      return;
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        buffer += decoder.decode(result.value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          this.consume_sse_frame(frame);
        }
      }
      if (buffer !== "") {
        this.consume_sse_frame(buffer);
      }
    } finally {
      reader.releaseLock();
      if (this.upstream_abort_controller === abort_controller) {
        this.upstream_abort_controller = null;
      }
    }
  }

  /**
   * 解析单个 SSE frame；keepalive 和坏 JSON 不应中断整条事件流。
   */
  private consume_sse_frame(frame: string): void {
    if (frame.trim() === "" || frame.trimStart().startsWith(":")) {
      return;
    }
    const lines = frame.split(/\r?\n/);
    const event_line = lines.find((line) => line.startsWith("event:"));
    const event_type = event_line?.slice("event:".length).trim() ?? "";
    if (event_type === "") {
      return;
    }
    const data_text = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    try {
      const payload = JsonTool.parseStrict<ApiJsonValue>(data_text);
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        return;
      }
      if (event_type === "project.patch") {
        this.publish_project_patch(payload as JsonRecord);
      } else {
        this.publish(event_type, payload as JsonRecord);
      }
    } catch {
      return;
    }
  }

  /**
   * 将入站事件同步到 TaskRuntimeState，保证 snapshot 不再反查 Python。
   */
  private apply_runtime_state(event_type: string, payload: JsonRecord): void {
    if (event_type === "task.status_changed") {
      this.task_runtime_state.apply_status_event(payload);
      return;
    }
    if (event_type === "task.progress_changed") {
      this.task_runtime_state.apply_progress_event(payload);
      return;
    }
    if (event_type !== "project.patch") {
      return;
    }
    const patch = payload["patch"];
    if (!Array.isArray(patch)) {
      return;
    }
    for (const raw_operation of patch) {
      if (
        typeof raw_operation !== "object" ||
        raw_operation === null ||
        Array.isArray(raw_operation)
      ) {
        continue;
      }
      const operation = raw_operation as JsonRecord;
      if (operation["op"] === "replace_task" && this.is_record(operation["task"])) {
        this.task_runtime_state.apply_task_snapshot(operation["task"]);
      }
    }
  }

  /**
   * 广播只调用订阅者入口，断连清理由订阅者内部兜底。
   */
  private broadcast(frame: string): void {
    for (const subscriber of this.subscribers) {
      subscriber.enqueue(frame);
    }
  }

  /**
   * SSE frame 统一用严格 JSON 序列化，避免多行 data 手写失真。
   */
  private build_sse_frame(event_type: string, payload: JsonRecord): string {
    return `event: ${event_type}\ndata: ${JsonTool.stringifyStrict(payload)}\n\n`;
  }

  /**
   * 普通对象判断集中处理，避免数组被当作 patch task 块。
   */
  private is_record(value: ApiJsonValue | undefined): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /**
   * Promise 化定时器用于上游重连退避，不阻塞 Gateway 其它路由。
   */
  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
