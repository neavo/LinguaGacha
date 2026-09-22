import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentEntry, AgentTokenSpeedSnapshot } from "@shared/agent";
import { AgentRoundFooter } from "./agent-round-footer";

const state = vi.hoisted(() => ({ speed: null as AgentTokenSpeedSnapshot, transport: "ready" }));
const read_speed = vi.hoisted(() => vi.fn(() => state.speed));
vi.mock("@frontend/app/session/agent/agent-session-context", () => ({
  useAgentTokenSpeed: read_speed,
  useAgentControls: () => ({ transport: state.transport }),
}));
vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

type RoundEntry = Extract<AgentEntry, { delivery: "round" }>;
const running: RoundEntry = {
  kind: "user_message",
  delivery: "round",
  id: "current",
  text: "开始",
  attachments: [],
  status: "running",
  createdAt: 0,
  endedAt: null,
  averageTokensPerSecond: null,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  state.speed = null;
  state.transport = "ready";
  read_speed.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** 复用挂载实例，观察同一状态条在回合和连接状态变化后的输出。 */
async function render(...rounds: RoundEntry[]): Promise<void> {
  await act(async () =>
    root.render(rounds.map((user) => <AgentRoundFooter key={user.id} user={user} />)),
  );
}

it("仅当前回合订阅实时速度，历史均速不受断线或新回合速度影响", async () => {
  const history: RoundEntry = {
    ...running,
    id: "history",
    status: "success",
    endedAt: 7000,
    averageTokensPerSecond: 99.9,
  };
  await render(history);
  expect(read_speed).not.toHaveBeenCalled();

  state.speed = { roundId: "current", tokensPerSecond: 42.25 };
  await render(history, running);
  const footers = () =>
    [...container.querySelectorAll(".agent-round-footer")].map((node) => node.textContent);
  expect(footers()[0]).toContain("99.90 T/S");
  expect(footers()[1]).toContain("42.25 T/S");
  for (const transport of ["disconnected", "restoring"]) {
    state.transport = transport;
    await render(history, running);
    expect(footers()[0]).toContain("99.90 T/S");
    expect(footers()[1]).not.toContain("T/S");
  }
  state.transport = "ready";
  await render(history, running);
  expect(footers()[1]).toContain("42.25 T/S");
});

it("无数据和其他回合速度不显示分隔符，有效零值和失败结算正常展示", async () => {
  for (const speed of [null, { roundId: "other", tokensPerSecond: 100 }]) {
    state.speed = speed;
    await render(running);
    expect(container.querySelector(".agent-round-footer__speed")).toBeNull();
  }
  state.speed = { roundId: "current", tokensPerSecond: 0 };
  await render(running);
  expect(container.textContent).toContain("0.00 T/S");
  await render({ ...running, status: "error", endedAt: 2000, averageTokensPerSecond: 18.5 });
  expect(container.textContent).toContain("18.50 T/S");
  await render({ ...running, status: "stopped", endedAt: 2000 });
  expect(container.querySelector(".agent-round-footer__speed")).toBeNull();
});
