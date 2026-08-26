import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_SCROLL_BOTTOM_TOLERANCE_PX, useAgentFollowLatest } from "./agent-scroll";

type FollowLatestApi = ReturnType<typeof useAgentFollowLatest>;
type FollowLatestProbeProps = {
  initial_following: boolean;
  on_ready: (api: FollowLatestApi) => void;
};

/** 只暴露 Hook 的公开归底 API，不复制其内部调度状态。 */
function FollowLatestProbe(props: FollowLatestProbeProps): JSX.Element | null {
  const api = useAgentFollowLatest(props.initial_following);
  useEffect(() => {
    props.on_ready(api);
  }, [api, props.on_ready]);
  return null;
}

describe("useAgentFollowLatest", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let next_frame_id = 1;
  let pending_frames = new Map<number, FrameRequestCallback>(); // 可控的 requestAnimationFrame 队列

  beforeEach(() => {
    pending_frames = new Map();
    next_frame_id = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
      const id = next_frame_id++;
      pending_frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
      pending_frames.delete(id);
    });
  });

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    pending_frames.clear();
    vi.unstubAllGlobals();
  });

  async function render(element: JSX.Element): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }
    await act(async () => root?.render(element));
  }

  /** 同步执行当前帧，避免测试依赖真实时钟。 */
  function flush_frames(): void {
    const frames = [...pending_frames.values()];
    pending_frames.clear();
    for (const callback of frames) callback(0);
  }

  /** 构造可观察的滚动目标，只保留归底行为需要的几何属性。 */
  function scroll_target(): {
    target: HTMLElement;
    read_top: () => number;
    read_end: () => number;
    set_top: (value: number) => void;
    set_height: (value: number) => void;
  } {
    const target = document.createElement("div");
    let scroll_top = 0;
    let scroll_height = 1_000;
    const client_height = 400;
    const scroll_end = (): number => Math.max(0, scroll_height - client_height);
    Object.defineProperties(target, {
      scrollHeight: { configurable: true, get: () => scroll_height },
      clientHeight: { configurable: true, value: client_height },
      scrollTop: {
        configurable: true,
        get: () => scroll_top,
        set: (value: number) => {
          scroll_top = Math.max(0, Math.min(value, scroll_end()));
        },
      },
    });
    return {
      target,
      read_top: () => scroll_top,
      read_end: scroll_end,
      set_top: (value) => (target.scrollTop = value),
      set_height: (value) => (scroll_height = value),
    };
  }

  it("跟随时合并同一帧的内容变化并归底", async () => {
    let api!: FollowLatestApi;
    await render(<FollowLatestProbe initial_following on_ready={(next_api) => (api = next_api)} />);
    const scroll = scroll_target();
    const initial_top = scroll.read_top();

    api.follow_content(scroll.target);
    api.follow_content(scroll.target);
    expect(scroll.read_top()).toBe(initial_top);
    expect(pending_frames.size).toBe(1);

    flush_frames();
    expect(scroll.read_top()).toBe(scroll.read_end());
  });

  it("离开底部时取消排队跟随，显式激活仍然立即归底", async () => {
    let api!: FollowLatestApi;
    await render(
      <FollowLatestProbe initial_following={false} on_ready={(next_api) => (api = next_api)} />,
    );
    const scroll = scroll_target();
    const initial_top = scroll.read_top();

    api.follow_content(scroll.target);
    flush_frames();
    expect(scroll.read_top()).toBe(initial_top);

    await act(async () => api.activate(scroll.target));
    expect(scroll.read_top()).toBe(scroll.read_end());
    expect(api.following).toBe(true);

    scroll.set_top(scroll.target.scrollHeight - scroll.target.clientHeight - 32);
    api.follow_content(scroll.target);
    await act(async () => api.handle_scroll(scroll.target));
    expect(api.following).toBe(false);
    flush_frames();
    expect(scroll.read_top()).toBe(scroll.target.scrollHeight - scroll.target.clientHeight - 32);
  });

  it("内容快速增长后的迟到滚动事件不会退出跟随", async () => {
    let api!: FollowLatestApi;
    await render(<FollowLatestProbe initial_following on_ready={(next_api) => (api = next_api)} />);
    const scroll = scroll_target();
    api.scroll_to_end(scroll.target);
    expect(scroll.read_top()).toBe(scroll.read_end());

    scroll.set_height(1_200);
    await act(async () => api.handle_scroll(scroll.target));
    expect(api.following).toBe(true);

    api.follow_content(scroll.target);
    flush_frames();
    expect(scroll.read_top()).toBe(scroll.read_end());
  });

  it("已经在底部时重复激活也不依赖滚动事件完成跟随", async () => {
    let api!: FollowLatestApi;
    await render(
      <FollowLatestProbe initial_following={false} on_ready={(next_api) => (api = next_api)} />,
    );
    const scroll = scroll_target();

    await act(async () => api.activate(scroll.target));
    await act(async () => api.activate(scroll.target));
    scroll.set_height(1_200);
    api.follow_content(scroll.target);
    flush_frames();

    expect(api.following).toBe(true);
    expect(scroll.read_top()).toBe(scroll.read_end());
  });

  it("底部容差内的滚动不会取消跟随", async () => {
    let api!: FollowLatestApi;
    await render(<FollowLatestProbe initial_following on_ready={(next_api) => (api = next_api)} />);
    const scroll = scroll_target();
    scroll.set_top(
      scroll.target.scrollHeight - scroll.target.clientHeight - AGENT_SCROLL_BOTTOM_TOLERANCE_PX,
    );

    await act(async () => api.handle_scroll(scroll.target));
    expect(api.following).toBe(true);
  });

  it("卸载时取消尚未执行的跟随帧", async () => {
    let api!: FollowLatestApi;
    await render(<FollowLatestProbe initial_following on_ready={(next_api) => (api = next_api)} />);
    const scroll = scroll_target();
    const initial_top = scroll.read_top();
    api.follow_content(scroll.target);
    expect(pending_frames.size).toBe(1);

    await act(async () => root?.unmount());
    root = null;
    flush_frames();
    expect(scroll.read_top()).toBe(initial_top);
  });
});
