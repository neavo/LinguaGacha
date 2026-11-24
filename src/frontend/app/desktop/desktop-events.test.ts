import { AGENT_CHAT_EVENT_TOPIC } from "@shared/agent";
import { expect, it, vi } from "vitest";
import { open_event_stream } from "./desktop-api";
import { subscribe_desktop_events } from "./desktop-events";

vi.mock("./desktop-api", () => ({ open_event_stream: vi.fn() }));

it("共享连接按工程分发，并在显式重试时重接已有订阅", () => {
  const event_source = () => Object.assign(new EventTarget(), { readyState: 1, close: vi.fn() });
  const first = event_source();
  const second = event_source();
  for (const source of [first, second])
    vi.mocked(open_event_stream).mockReturnValueOnce(source as unknown as EventSource);

  const payload = { projectId: "current", chatId: "same" };
  const current = vi.fn();
  const old_project = vi.fn();
  const mirror = vi.fn();
  const cleanups = [
    subscribe_desktop_events({
      projectId: payload.projectId,
      events: { [AGENT_CHAT_EVENT_TOPIC]: current },
    }),
    subscribe_desktop_events({
      projectId: "closed",
      events: { [AGENT_CHAT_EVENT_TOPIC]: old_project },
    }),
  ];
  const emit = (source: EventTarget) =>
    source.dispatchEvent(
      new MessageEvent(AGENT_CHAT_EVENT_TOPIC, {
        data: JSON.stringify(payload),
      }),
    );
  try {
    expect(open_event_stream).toHaveBeenCalledOnce();
    emit(first);
    expect(current).toHaveBeenCalledExactlyOnceWith(payload);
    expect(old_project).not.toHaveBeenCalled();

    first.readyState = 2; // EventSource.CLOSED，jsdom 由测试替身实现传输。
    cleanups.push(subscribe_desktop_events({ events: { [AGENT_CHAT_EVENT_TOPIC]: mirror } }));
    emit(first);
    emit(second);
    expect(current).toHaveBeenCalledTimes(2);
    expect(old_project).not.toHaveBeenCalled();
    expect(mirror.mock.calls[0]?.[0]).toBe(current.mock.calls[1]?.[0]);
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
  expect(second.close).toHaveBeenCalledOnce();
});
