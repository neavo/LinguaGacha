import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INPUT_QUERY_DEBOUNCE_MS,
  useDebouncedCallback,
  useDebouncedValue,
} from "@frontend/widgets/interactions/use-debounce";

type DebouncedValueProbeProps = {
  value: string;
  on_value: (value: string) => void;
};

function DebouncedValueProbe(props: DebouncedValueProbeProps): JSX.Element | null {
  const debounced_value = useDebouncedValue(props.value);

  useEffect(() => {
    props.on_value(debounced_value);
  }, [debounced_value, props.on_value]);

  return null;
}

type DebouncedCallbackProbeProps = {
  on_ready: (api: {
    schedule: (value: string) => void;
    cancel: () => void;
    flush: () => void;
  }) => void;
  on_run: (value: string) => void;
};

type DebouncedCallbackProbeApi = Parameters<DebouncedCallbackProbeProps["on_ready"]>[0];

function DebouncedCallbackProbe(props: DebouncedCallbackProbeProps): JSX.Element | null {
  const debounced_callback = useDebouncedCallback((value: string) => {
    props.on_run(value);
  });

  useEffect(() => {
    props.on_ready(debounced_callback);
  }, [debounced_callback, props.on_ready]);

  return null;
}

describe("useDebounce", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    vi.useRealTimers();
  });

  async function render(element: JSX.Element): Promise<void> {
    if (container === null) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
    }

    await act(async () => {
      root?.render(element);
    });
  }

  it("防抖值在窗口结束前保持旧值，窗口结束后发布最新输入", async () => {
    vi.useFakeTimers();
    const values: string[] = [];
    const record_value = (value: string): void => {
      values.push(value);
    };

    await render(<DebouncedValueProbe value="初始" on_value={record_value} />);
    expect(values).toEqual(["初始"]);

    await render(<DebouncedValueProbe value="新输入" on_value={record_value} />);
    expect(values).toEqual(["初始"]);

    await act(async () => {
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS - 1);
    });
    expect(values).toEqual(["初始"]);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(values).toEqual(["初始", "新输入"]);
  });

  it("防抖回调只在窗口结束后执行最后一次计划", async () => {
    vi.useFakeTimers();
    const runs: string[] = [];
    let api: DebouncedCallbackProbeApi | null = null;

    await render(
      <DebouncedCallbackProbe
        on_run={(value) => runs.push(value)}
        on_ready={(next_api) => {
          api = next_api;
        }}
      />,
    );

    await act(async () => {
      if (api === null) {
        throw new Error("防抖回调探针尚未初始化。");
      }
      api.schedule("第一次");
      api.schedule("第二次");
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
    });

    expect(runs).toEqual(["第二次"]);
  });

  it("flush 会立即执行待处理回调并清空 timer", async () => {
    vi.useFakeTimers();
    const runs: string[] = [];
    let api: DebouncedCallbackProbeApi | null = null;

    await render(
      <DebouncedCallbackProbe
        on_run={(value) => runs.push(value)}
        on_ready={(next_api) => {
          api = next_api;
        }}
      />,
    );

    await act(async () => {
      if (api === null) {
        throw new Error("防抖回调探针尚未初始化。");
      }
      api.schedule("立刻执行");
      api.flush();
      vi.advanceTimersByTime(INPUT_QUERY_DEBOUNCE_MS);
    });

    expect(runs).toEqual(["立刻执行"]);
  });
});
