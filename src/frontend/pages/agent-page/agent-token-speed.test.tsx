import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { AgentTokenSpeed } from "./agent-token-speed";

const state = vi.hoisted(() => ({ tokensPerSecond: null as number | null, transport: "ready" }));
vi.mock("@frontend/app/session/agent/agent-session-context", () => ({
  useAgentTokenSpeed: () => state,
  useAgentControls: () => state,
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: () => "实时速度" }),
}));

let root: Root | null = null;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  root = null;
});

it("底栏按两位小数显示 TPS，支持应用提示，空值和断线隐藏", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  /** 复用同一组件实例观察连接恢复和速度变化。 */
  const render = async (speed: number | null, transport = "ready") => {
    state.tokensPerSecond = speed;
    state.transport = transport;
    await act(async () =>
      root?.render(
        <TooltipProvider>
          <AgentTokenSpeed />
        </TooltipProvider>,
      ),
    );
  };
  await render(null);
  expect(container.textContent).toBe("");
  await render(99.9);
  expect(container.textContent).toBe("99.90 T/S");
  await act(async () => container.querySelector<HTMLElement>(".agent-token-speed")!.focus());
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  await render(0);
  expect(container.textContent).toBe("0.00 T/S");
  await render(12, "disconnected");
  expect(container.textContent).toBe("");
  await render(12, "restoring");
  expect(container.textContent).toBe("");
  await render(12);
  expect(container.textContent).toBe("12.00 T/S");
});
