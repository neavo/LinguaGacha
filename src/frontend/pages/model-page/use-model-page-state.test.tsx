import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MODEL_TYPES } from "@domain/model";

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
  useDesktopState: () => ({ runtime_snapshot: { revision: 0, owner: null } }),
  useRuntimeSnapshot: () => ({ revision: 0, owner: null }),
}));

vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  useDesktopToast: () => ({ push_toast }),
}));

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: translate }),
}));

/** 模拟后端分组与操作权限，刷新时可替换目录事实。 */
function create_snapshot(name = "自定义模型") {
  return {
    snapshot: {
      models: [
        { id: "preset", type: "PRESET", name: "内置模型", can_reset: true },
        { id: "custom", type: "CUSTOM_OPENAI", name, can_reset: false },
        {
          id: "responses",
          type: "CUSTOM_OPENAI_RESPONSES",
          api_format: "OpenAIResponses",
          name: "Responses 模型",
          can_reset: false,
        },
      ],
    },
  };
}

/** 手动控制请求完成顺序，验证刷新和保存之间的竞争。 */
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

  /** 通过公开 Hook 返回值观察状态。 */
  function Probe(): null {
    latest_state = useModelPageState();
    return null;
  }

  /** 挂载 Hook 并等待首次快照处理完成。 */
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

  it("首次加载失败可重试，刷新失败保留已读取模型", async () => {
    api_fetch_mock.mockRejectedValueOnce(new Error("offline"));
    await render_hook();
    expect(latest_state?.load_status).toBe("error");
    expect(push_toast).not.toHaveBeenCalled();
    api_fetch_mock.mockResolvedValue(create_snapshot());
    await act(async () => latest_state?.refresh_snapshot());
    expect(latest_state?.load_status).toBe("ready");
    const snapshot = latest_state?.snapshot;
    api_fetch_mock.mockRejectedValueOnce(new Error("offline"));
    await act(async () => latest_state?.refresh_snapshot());
    expect(latest_state?.snapshot).toBe(snapshot);
    expect(latest_state?.load_status).toBe("ready");
    expect(push_toast).toHaveBeenCalledWith("error", "model_page.feedback.refresh_failed");
  });

  it("加载并分组模型，自定义分组内唯一模型不能删除", async () => {
    api_fetch_mock.mockResolvedValue(create_snapshot());
    await render_hook();

    expect(latest_state?.grouped_categories.map((category) => category.type)).toEqual(MODEL_TYPES);
    expect(
      latest_state?.grouped_categories.find(
        (category) => category.type === "CUSTOM_OPENAI_RESPONSES",
      ),
    ).toMatchObject({
      models: [{ id: "responses", api_format: "OpenAIResponses" }],
    });
    await act(async () => latest_state?.request_delete_model("custom"));

    expect(latest_state?.confirm_state).toEqual({ kind: null, model_id: null });
    expect(push_toast).toHaveBeenCalledWith("warning", "model_page.feedback.delete_last_one");
  });

  it("刷新下架预设的操作能力，允许删除预设分组最后一项", async () => {
    const response = create_snapshot();
    api_fetch_mock.mockResolvedValue(response);
    await render_hook();
    expect(latest_state?.snapshot.models[0]).toMatchObject({ can_reset: true });
    response.snapshot.models[0]!.can_reset = false;
    await act(async () => latest_state?.refresh_snapshot());
    expect(latest_state?.snapshot.models[0]).toMatchObject({ type: "PRESET", can_reset: false });
    await act(async () => latest_state?.request_delete_model("preset"));
    expect(latest_state?.confirm_state).toEqual({ kind: "delete", model_id: "preset" });
    expect(push_toast).not.toHaveBeenCalled();
  });

  it("乐观更新合并 Agent 容量并保留同组字段", async () => {
    api_fetch_mock.mockResolvedValue(create_snapshot());
    await render_hook();
    const update = create_deferred<ReturnType<typeof create_snapshot>>();
    api_fetch_mock.mockReturnValue(update.promise);

    let request!: Promise<void>;
    await act(async () => {
      request = latest_state!.update_model_patch("custom", {
        agent: { context_window: 300_000 },
      });
      await Promise.resolve();
    });
    expect(latest_state?.snapshot.models[1]?.agent).toEqual({
      context_window: 300_000,
      max_output_tokens: 0,
    });

    update.resolve(create_snapshot());
    await act(async () => request);
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
