import type { AppEvent, AppEventOfType, AppEventType } from "./app-events";

// AppEventHandler 是 Core 内部 committed event 的订阅入口，按事件类型收窄 payload。
export type AppEventHandler<TType extends AppEventType = AppEventType> = (
  event: AppEventOfType<TType>,
) => void | Promise<void>;

// AppEventDispatchResult 保留每个订阅者的执行结果，调用方可决定是否阻断后续发布链路。
export type AppEventDispatchResult = {
  type: AppEventType;
  handlerIndex: number;
  ok: boolean;
  error?: unknown;
};

type AppEventHandlerEntry = {
  type: AppEventType;
  handler: (event: AppEvent) => void | Promise<void>;
};

// AppEventBus 是 Core 内部事务提交后事件分发器，不直接承担公开 SSE 或 renderer 刷新策略。
export class AppEventBus {
  private readonly handlers: AppEventHandlerEntry[] = [];

  /**
   * 订阅指定 committed event，并返回幂等取消函数。
   */
  public subscribe<TType extends AppEventType>(
    type: TType,
    handler: AppEventHandler<TType>,
  ): () => void {
    const entry: AppEventHandlerEntry = {
      type,
      handler: (event) => handler(event as AppEventOfType<TType>),
    };
    this.handlers.push(entry);
    return () => {
      const index = this.handlers.indexOf(entry);
      if (index >= 0) {
        this.handlers.splice(index, 1);
      }
    };
  }

  /**
   * 按订阅顺序等待所有 handler；单个 handler 失败会记录结果并继续分发后续订阅者。
   */
  public async publish(event: AppEvent): Promise<AppEventDispatchResult[]> {
    const results: AppEventDispatchResult[] = [];
    const handlers = this.handlers.filter((entry) => entry.type === event.type);
    for (const [handler_index, entry] of handlers.entries()) {
      try {
        await entry.handler(event as never);
        results.push({
          type: event.type,
          handlerIndex: handler_index,
          ok: true,
        });
      } catch (error) {
        results.push({
          type: event.type,
          handlerIndex: handler_index,
          ok: false,
          error,
        });
      }
    }
    return results;
  }
}
