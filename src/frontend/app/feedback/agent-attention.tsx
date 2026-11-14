import { useEffect, useRef } from "react";
import type { AgentPendingDecision } from "@shared/agent";
import {
  useAgentChatId,
  useAgentControls,
  useAgentEntry,
  useAgentTimeline,
} from "@frontend/app/session/agent/agent-chat-context";
import { request_user_attention } from "./desktop-attention";

/** 已请求提醒的会话与待决事项身份。 */
type RequestedDecisionIdentity = {
  chatId: string;
  kind: AgentPendingDecision["kind"];
  id: string;
};

/**
 * 跨路由观察 Agent 待决事项与普通轮次终态，统一委托桌面适配层发起提醒。
 */
export function AgentAttention(): null {
  const chat_id = useAgentChatId();
  const { state, pendingDecision, transport, command } = useAgentControls();
  const { latestRoundId } = useAgentTimeline();
  const round = useAgentEntry(latestRoundId);

  const last_decision_ref = useRef<RequestedDecisionIdentity | null>(null); // 重连和命令往返保留去重身份
  const running_chat_id_ref = useRef<string | null>(null); // 运行记忆绑定到 chatId，防止切工程时把旧会话运行误判为新会话终态

  useEffect(() => {
    if (chat_id === null || transport !== "ready" || command !== null || pendingDecision === null) {
      return;
    }
    const last = last_decision_ref.current;
    if (
      last !== null &&
      last.chatId === chat_id &&
      last.kind === pendingDecision.kind &&
      last.id === pendingDecision.id
    ) {
      return;
    }
    // 发送前锁定身份，宿主返回 false 或播放失败不撤销记录以免重渲染循环尝试。
    last_decision_ref.current = {
      chatId: chat_id,
      kind: pendingDecision.kind,
      id: pendingDecision.id,
    };
    void request_user_attention();
  }, [chat_id, transport, command, pendingDecision]);

  useEffect(() => {
    if (chat_id === null) {
      running_chat_id_ref.current = null;
      return;
    }
    if (state === "running") {
      running_chat_id_ref.current = chat_id;
      return;
    }
    if (running_chat_id_ref.current !== chat_id) {
      running_chat_id_ref.current = null;
      return;
    }
    if (state === "stopping" || transport !== "ready") {
      return;
    }
    running_chat_id_ref.current = null;
    // 时间线按发生顺序追加，普通用户轮次的终态决定是否提醒。
    if (round?.status === "success" || round?.status === "error") {
      void request_user_attention();
    }
  }, [chat_id, state, transport, round]);

  return null;
}
