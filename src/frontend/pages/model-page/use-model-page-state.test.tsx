import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useModelPageState } from "./use-model-page-state";

const { api_fetch_mock, push_toast, translate } = vi.hoisted(() => ({
  api_fetch_mock: vi.fn(),
  push_toast: vi.fn(),
  translate: (key: string) => key,
}));

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_fetch: api_fetch_mock,
}));

vi.mock("@frontend/app/state/use-desktop-state", () => ({
  useDesktopState: () => ({ task_snapshot: { busy: false } }),
}));

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  useDesktopToast: () => ({ push_toast }),
}));

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: translate }),
}));

function create_snapshot(name = "自定义模型") {
  return {
    snapshot: {
      active_model_id: "preset",
      models: [
        { id: "preset", type: "PRESET", name: "内置模型" },
        { id: "custom", type: "CUSTOM_OPENAI", name },
      ],
    },
  };
}

function create_deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promise_resolve) => {
    resolve = promise_resolve;
  });
  return { promise, resolve };
}

describe("useModelPageState", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let latest_state: ReturnType<typeof useModelPageState> | null = null;

  function Probe(): null {
    latest_state = useModelPageState();
    return null;
  }

  async function render_hook(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  afterEach(async () => {
    if (root !== null) {
      await act(async () => root?.unmount());
    }
    container?.remove();
    container = null;
    root = null;
    latest_state = null;
    api_fetch_mock.mockReset();
    push_toast.mockReset();
  });

  it("加载并分组模型，分组内唯一模型不能删除", async () => {
    api_fetch_mock.mockResolvedValue(create_snapshot());
    await render_hook();

    expect(latest_state?.grouped_categories.map((category) => category.type)).toEqual([
      "PRESET",
      "CUSTOM_GOOGLE",
      "CUSTOM_OPENAI",
      "CUSTOM_ANTHROPIC",
    ]);
    expect(latest_state?.snapshot.models[1]).toMatchObject({
      id: "custom",
      api_format: "OpenAI",
      threshold: { input_token_limit: 512, output_token_limit: 4096 },
    });

    await act(async () => latest_state?.request_delete_model("custom"));

    expect(latest_state?.confirm_state).toEqual({ kind: null, model_id: null });
    expect(push_toast).toHaveBeenCalledWith("warning", "model_page.feedback.delete_last_one");
  });

  it("并发更新只接受同一模型最后一次请求的回包", async () => {
    api_fetch_mock.mockResolvedValue(create_snapshot());
    await render_hook();
    const first = create_deferred<ReturnType<typeof create_snapshot>>();
    const second = create_deferred<ReturnType<typeof create_snapshot>>();
    api_fetch_mock.mockImplementation(async (_path: string, body: { patch?: { name?: string } }) =>
      body.patch?.name === "第一次" ? first.promise : second.promise,
    );

    let first_update!: Promise<void>;
    let second_update!: Promise<void>;
    await act(async () => {
      first_update = latest_state!.update_model_patch("custom", { name: "第一次" });
      second_update = latest_state!.update_model_patch("custom", { name: "第二次" });
      await Promise.resolve();
    });
    expect(latest_state?.snapshot.models[1]?.name).toBe("第二次");

    second.resolve(create_snapshot("服务端第二次"));
    await act(async () => second_update);
    first.resolve(create_snapshot("服务端第一次"));
    await act(async () => first_update);

    expect(latest_state?.snapshot.models[1]?.name).toBe("服务端第二次");
  });
});
