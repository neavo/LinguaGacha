import type { ApiJsonValue } from "./api-types";
import { JsonTool } from "../../shared/utils/json-tool";

const KEEPALIVE_INTERVAL_MS = 500; // 公开 API stream keepalive 仍由服务端发出，renderer 不需要感知上游是否短暂重连

// 公开 SSE data 的 JSON 对象形状，所有 topic 共享同一窄边界
export type ApiStreamPayload = Record<string, ApiJsonValue>;

export interface ApiStreamMessage {
  topic: string; // 与 SSE event 字段值完全一致，避免本地订阅和公开 stream 分叉
  payload: ApiStreamPayload; // 已经适配好的公开 JSON 载荷，订阅者不能读取领域对象
}

export type ApiStreamListener = (message: ApiStreamMessage) => void;

interface HubSubscriber {
  enqueue: (text: string) => void; // 单个 SSE 连接的写入口
  close: () => void; // 负责连接级清理，Gateway stop 时统一调用
}

/**
 * 公开 API stream hub，负责同进程 topic 订阅与 `/api/events/stream` SSE 连接
 */
export class ApiStreamHub {
  private readonly subscribers = new Set<HubSubscriber>(); // 只保存当前公开 SSE 连接的写入口，断连清理由订阅者内部完成

  private readonly local_subscribers = new Map<string, Set<ApiStreamListener>>(); // 让 CLI 等同进程入口复用公开 stream 事实源

  private started = false; // 防止 Gateway 重复 start 时重入初始化

  /**
   * 标记 API stream 已启动；公开消息来源统一由服务层主动 publish
   */
  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
  }

  /**
   * Gateway 停止时主动中断订阅者，避免测试或重启泄漏长连接
   */
  public stop(): void {
    for (const subscriber of this.subscribers) {
      subscriber.close();
    }
    this.subscribers.clear();
    this.local_subscribers.clear();
  }

  /**
   * 发布公开运行期 stream 消息；领域状态必须在调用方写好，hub 只负责广播
   */
  public publish(topic: string, payload: ApiStreamPayload): void {
    this.dispatch_local_message(topic, payload);
    this.broadcast(this.build_sse_frame(topic, payload));
  }

  /**
   * 订阅同进程公开 stream；订阅者只接收指定 topic，取消函数必须由调用方在任务结束时执行。
   */
  public subscribe(topic: string, listener: ApiStreamListener): () => void {
    let listeners = this.local_subscribers.get(topic);
    if (listeners === undefined) {
      listeners = new Set<ApiStreamListener>();
      this.local_subscribers.set(topic, listeners);
    }
    listeners.add(listener);
    return () => {
      const current_listeners = this.local_subscribers.get(topic);
      if (current_listeners === undefined) {
        return;
      }
      current_listeners.delete(listener);
      if (current_listeners.size === 0) {
        this.local_subscribers.delete(topic);
      }
    };
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
   * 本地订阅者使用公开 stream message，不允许反向接触领域对象；复制 Set 避免取消订阅影响本轮派发。
   */
  private dispatch_local_message(topic: string, payload: ApiStreamPayload): void {
    const listeners = this.local_subscribers.get(topic);
    if (listeners === undefined) {
      return;
    }
    const message: ApiStreamMessage = { topic, payload };
    for (const listener of Array.from(listeners)) {
      listener(message);
    }
  }

  /**
   * SSE frame 统一用严格 JSON 序列化，避免多行 data 手写失真
   */
  private build_sse_frame(topic: string, payload: ApiStreamPayload): string {
    return `event: ${topic}\ndata: ${JsonTool.stringifyStrict(payload)}\n\n`;
  }
}
