import { useEffect, useRef } from "react";

import type { AgentEntry, AgentSessionState } from "@shared/agent";
import {
  useAgentControls,
  useAgentTimeline,
} from "@frontend/app/session/agent/agent-session-context";

/** 注意力判定只依赖会话状态和时间线，不把完整 controller 形状带进纯规则。 */
type AgentCompletionSnapshot = Readonly<{
  state: AgentSessionState;
  entries: readonly AgentEntry[];
}>;

/** 记录一次 effect 观察到的运行收束，并把 ref 更新与宿主请求拆开表达。 */
export type AgentCompletionAttentionTransition = Readonly<{
  was_running: boolean;
  should_request: boolean;
}>;

/**
 * 只在观察到本次运行后再接受最终 round，避免首次恢复历史终态时补发提示。
 */
export function resolve_agent_completion_attention(
  was_running: boolean,
  snapshot: AgentCompletionSnapshot,
): AgentCompletionAttentionTransition {
  if (snapshot.state === "running") {
    return { was_running: true, should_request: false };
  }

  if (!was_running) {
    return { was_running: false, should_request: false };
  }

  // AgentService 按真实时间线顺序追加条目，最新 round user 才是本次收束的结果。
  const latest_round = snapshot.entries.findLast(is_round_entry);
  const should_request = latest_round?.status === "success" || latest_round?.status === "error";
  return { was_running: false, should_request };
}

/** 只把普通 round user 当作一次可提醒的 Agent 运行，不把 steer 或工具条目算入其中。 */
function is_round_entry(entry: AgentEntry): boolean {
  return entry.kind === "user_message" && entry.delivery === "round";
}

/**
 * 跨路由观察 Agent 终态；宿主只收到无参数的注意力请求，不承载 Agent 业务字段。
 */
export function AgentCompletionAttention(): null {
  const { state } = useAgentControls();
  const { entries } = useAgentTimeline();
  const was_running_ref = useRef(false); // 只记住已观察到的运行，避免恢复历史终态时补发提醒

  useEffect(() => {
    const transition = resolve_agent_completion_attention(was_running_ref.current, {
      state,
      entries,
    });
    was_running_ref.current = transition.was_running;
    if (transition.should_request) {
      window.desktopApp.requestUserAttention();
    }
  }, [entries, state]);

  return null;
}
