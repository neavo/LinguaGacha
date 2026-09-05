import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelThinkingLevel } from "@domain/model";
import { useModelSelection } from "./use-model-selection";

const api = vi.hoisted(() => ({ get: vi.fn(), fetch: vi.fn() }));
const push_toast = vi.hoisted(() => vi.fn());
const translate = vi.hoisted(() => (key: string) => key);

vi.mock("@frontend/app/desktop/desktop-api", () => ({
  api_get: api.get,
  api_fetch: api.fetch,
}));
vi.mock("@frontend/app/feedback/desktop-toast", () => ({
  useDesktopToast: () => ({ push_toast }),
}));
vi.mock("@frontend/app/feedback/visible-error-message", () => ({
  resolve_visible_error_message: (_error: unknown, _t: unknown, fallback: string) => fallback,
}));
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: translate }),
}));

describe("useModelSelection", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map(async (root) => act(async () => root.unmount())));
    api.get.mockReset();
    api.fetch.mockReset();
    push_toast.mockReset();
  });

  it("不提交当前模型、阻止并发且只在后端回包后更新", async () => {
    api.get.mockResolvedValue(snapshot("preset"));
    let resolve_update = (_value: unknown): void => undefined;
    api.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolve_update = resolve;
        }),
    );
    const container = await render_probe();
    await wait_for_text(container, "preset:OFF:false");

    act(() => {
      find_button(container, "same").click();
      find_button(container, "change").click();
      find_button(container, "other").click();
    });

    expect(api.fetch).toHaveBeenCalledOnce();
    expect(api.fetch).toHaveBeenCalledWith("/api/models/select", {
      usage: "translation",
      model_id: "openai",
    });
    expect(container.textContent).toContain("preset:OFF:true");

    await act(async () => {
      resolve_update(snapshot("openai"));
      await Promise.resolve();
    });
    expect(container.textContent).toContain("openai:OFF:false");
  });

  it("更新当前用途模型的思考档位并消费统一窄回包", async () => {
    api.get.mockResolvedValue(snapshot("preset"));
    api.fetch.mockResolvedValue(snapshot("preset", "HIGH"));
    const container = await render_probe();
    await wait_for_text(container, "preset:OFF:false");

    await act(async () => find_button(container, "thinking").click());

    expect(api.fetch).toHaveBeenCalledWith("/api/models/thinking-level/update", {
      usage: "translation",
      thinking_level: "HIGH",
    });
    expect(container.textContent).toContain("preset:HIGH:false");
  });

  it("更新失败保留旧快照并显示统一错误", async () => {
    api.get.mockResolvedValue(snapshot("preset"));
    api.fetch.mockRejectedValue(new Error("offline"));
    const container = await render_probe();
    await wait_for_text(container, "preset:OFF:false");

    await act(async () => find_button(container, "change").click());
    await wait_for_text(container, "preset:OFF:false");

    expect(push_toast).toHaveBeenCalledWith("error", "app.model.selection.update_failed");
  });

  async function render_probe(): Promise<HTMLDivElement> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<Probe />));
    return container;
  }
});

function Probe(): JSX.Element {
  const controller = useModelSelection();
  const selected = controller.snapshot.models.find(
    (model) => model.id === controller.snapshot.model_selection.translation,
  );
  return (
    <div>
      <span>{`${controller.snapshot.model_selection.translation}:${selected?.thinking_level ?? "OFF"}:${controller.updating.toString()}`}</span>
      <button onClick={() => void controller.select_model("translation", "preset")}>same</button>
      <button onClick={() => void controller.select_model("translation", "openai")}>change</button>
      <button onClick={() => void controller.select_model("agent", "openai")}>other</button>
      <button onClick={() => void controller.update_thinking_level("translation", "HIGH")}>
        thinking
      </button>
    </div>
  );
}

function snapshot(selected: string, thinking_level: ModelThinkingLevel = "OFF"): unknown {
  return {
    model_selection: { translation: selected, agent: "preset" },
    models: [
      {
        id: "preset",
        type: "PRESET",
        name: "Preset",
        agent_limits: { context_window: 288_000, max_output_tokens: 32_000 },
        thinking_level,
        available_thinking_levels: ["OFF", "LOW", "MEDIUM", "HIGH", "XHIGH", "MAX"],
      },
      {
        id: "openai",
        type: "CUSTOM_OPENAI",
        name: "OpenAI",
        agent_limits: { context_window: 400_000, max_output_tokens: 50_000 },
        thinking_level: "OFF",
        available_thinking_levels: ["OFF", "LOW", "MEDIUM", "HIGH", "XHIGH", "MAX"],
      },
    ],
  };
}

function find_button(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (button === undefined) throw new Error(`缺少按钮：${label}`);
  return button;
}

async function wait_for_text(container: HTMLElement, text: string): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => expect(container.textContent).toContain(text));
  });
}
