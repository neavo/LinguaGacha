import { is_json_record, type JsonRecord } from "@domain/json";
import { open_event_stream } from "./desktop-api";

const EVENT_SOURCE_CLOSED = 2;

type DesktopEventSubscription = {
  events: Record<string, (payload: Record<string, unknown>) => void>;
  projectId?: string | undefined;
  onMalformed?: () => void;
  onOpen?: () => void;
  onError?: () => void;
};

type DesktopEvents = {
  source: EventSource;
  topics: Set<string>;
  subscribers: Set<DesktopEventSubscription>;
  open: boolean;
};

let connection: DesktopEvents | undefined; // 同一 renderer 的订阅共用原生连接。

/** 主窗口的状态域独立订阅，最后一个订阅离开时关闭共享连接。 */
export function subscribe_desktop_events(subscription: DesktopEventSubscription): () => void {
  if (connection === undefined) {
    connection = {
      source: open_event_stream(),
      topics: new Set(),
      subscribers: new Set(),
      open: false,
    };
    observe_connection(connection);
  } else if (connection.source.readyState === EVENT_SOURCE_CLOSED) {
    // 浏览器只会自动重连 CONNECTING 的连接。显式重试时恢复已永久关闭的连接。
    connection.source = open_event_stream();
    connection.topics.clear();
    connection.open = false;
    observe_connection(connection);
    for (const subscriber of connection.subscribers) observe_topics(connection, subscriber);
  }
  const active = connection;
  active.subscribers.add(subscription);
  observe_topics(active, subscription);
  if (active.open) subscription.onOpen?.();
  return () => {
    active.subscribers.delete(subscription);
    if (connection === active && active.subscribers.size === 0) {
      connection = undefined;
      active.source.close();
    }
  };
}

/** 显式重连后，旧连接的迟到通知不能切换新连接的状态。 */
function observe_connection(active: DesktopEvents): void {
  const source = active.source;
  source.onopen = () => {
    if (active.source !== source) return;
    active.open = true;
    for (const subscriber of active.subscribers) subscriber.onOpen?.();
  };
  source.onerror = () => {
    if (active.source !== source) return;
    active.open = false;
    for (const subscriber of active.subscribers) subscriber.onError?.();
  };
}

/** 一个主题只解码一次，再按订阅身份投递同一份载荷。 */
function observe_topics(active: DesktopEvents, subscription: DesktopEventSubscription): void {
  const source = active.source;
  for (const topic of Object.keys(subscription.events)) {
    if (active.topics.has(topic)) continue;
    active.topics.add(topic);
    source.addEventListener(topic, ((event: MessageEvent<string>) => {
      if (active.source !== source) return;
      let payload: JsonRecord | undefined;
      try {
        const decoded: unknown = JSON.parse(event.data);
        if (is_json_record(decoded)) payload = decoded;
      } catch {
        // 不完整的帧无法归属工程，由此主题的订阅者恢复快照。
      }
      for (const { events, projectId, onMalformed } of active.subscribers) {
        const receive = events[topic];
        if (receive === undefined) continue;
        if (payload === undefined) {
          if (onMalformed) onMalformed();
          else if (projectId === undefined) receive({});
          continue;
        }
        if (projectId !== undefined && projectId !== payload.projectId) continue;
        receive(payload);
      }
    }) as EventListener);
  }
}
