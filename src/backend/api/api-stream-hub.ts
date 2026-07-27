import type { JsonRecord } from "../../domain/json";
import { JsonTool } from "../../shared/utils/json-tool";

const KEEPALIVE_INTERVAL_MS = 500; // 公开 API stream keepalive 仍由服务端发出，renderer 不需要感知上游是否短暂重连

// 公开 SSE data 的 JSON 对象形状，所有 topic 共享同一窄边界
export type ApiStreamPayload = JsonRecord;

interface HubSubscriber {
  enqueue: (text: string) => void; // 单个 SSE 连接的写入口
  close: () => void; // 负责连接级清理，Gateway stop 时统一调用
}

/**
 * 公开 API stream hub，只负责 `/api/events/stream` 的 SSE 连接与广播。
 */
export class ApiStreamHub {
  private readonly subscribers = new Set<HubSubscriber>(); // 只保存当前公开 SSE 连接的写入口，断连清理由订阅者内部完成

  /**
   * Gateway 停止时主动中断订阅者，避免测试或重启泄漏长连接
   */
  public stop(): void {
    for (const subscriber of this.subscribers) {
      subscriber.close();
    }
    this.subscribers.clear();
  }

  /**
   * 发布公开运行期 stream 消息；领域状态必须在调用方写好，hub 只负责广播
   */
  public publish(topic: string, payload: ApiStreamPayload): void {
    this.broadcast(this.build_sse_frame(topic, payload));
  }

  /**
   * 为公开 `/api/events/stream` 创建订阅响应，订阅者只连接 API Gateway
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
              closed = true; // 下游 reader 可能已经取消；订阅已失效，移除即可避免后续 keepalive 重复写入
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
              // ReadableStream 可能已被下游关闭；Gateway 停止时重复 close 是无害清理
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
   * 广播只调用订阅者入口，断连清理由订阅者内部兜底
   */
  private broadcast(frame: string): void {
    for (const subscriber of this.subscribers) {
      subscriber.enqueue(frame);
    }
  }

  /**
   * SSE frame 统一用严格 JSON 序列化，避免多行 data 手写失真
   */
  private build_sse_frame(topic: string, payload: ApiStreamPayload): string {
    return `event: ${topic}\ndata: ${JsonTool.stringifyStrict(payload)}\n\n`;
  }
}
