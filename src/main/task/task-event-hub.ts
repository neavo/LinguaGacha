import type { ApiJsonValue } from "../api/api-types";
import { ProjectPatchAdapter } from "../project/project-patch-adapter";
import { JsonTool } from "../../shared/utils/json-tool";
import { TaskRuntimeState } from "./task-runtime-state";
import type { JsonRecord } from "./task-types";

// 公开事件流 keepalive 仍由服务端发出，renderer 不需要感知上游是否短暂重连。
const KEEPALIVE_INTERVAL_MS = 500;

interface TaskEventHubOptions {
  projectPatchAdapter: ProjectPatchAdapter;
  taskRuntimeState: TaskRuntimeState;
}

interface HubSubscriber {
  enqueue: (text: string) => void;
  close: () => void;
}

/**
 * API Gateway 事件 hub：广播公开 SSE 与本地事件。
 */
export class TaskEventHub {
  private readonly project_patch_adapter: ProjectPatchAdapter;

  private readonly task_runtime_state: TaskRuntimeState;

  private readonly subscribers = new Set<HubSubscriber>();

  private started = false;

  private stopping = false;

  /**
   * 事件 hub 只保存 main 进程内部依赖，不向 preload/renderer 暴露上游地址。
   */
  public constructor(options: TaskEventHubOptions) {
    this.project_patch_adapter = options.projectPatchAdapter;
    this.task_runtime_state = options.taskRuntimeState;
  }

  /**
   * 标记事件 hub 已启动；事件来源统一由 服务层主动 publish。
   */
  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
  }

  /**
   * Gateway 停止时主动中断上游和订阅者，避免测试或重启泄漏长连接。
   */
  public stop(): void {
    this.stopping = true;
    for (const subscriber of this.subscribers) {
      subscriber.close();
    }
    this.subscribers.clear();
  }

  /**
   * 本地服务发布设置或项目补丁时，也走同一条广播和运行态吸收路径。
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
   * 为公开 `/api/events/stream` 创建订阅响应，订阅者只连接 API Gateway。
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
        "Access-Control-Allow-Headers": "Content-Type",
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
   * 将入站事件同步到 TaskRuntimeState，保证 snapshot 不再反查非权威入口。
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
}
