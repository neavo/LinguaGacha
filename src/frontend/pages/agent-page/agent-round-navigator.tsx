import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import {
  type JSX,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import type { AgentEntry, AgentEntryStatus } from "@shared/agent";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import {
  AgentChatStoreContext,
  useAgentEntry,
  useAgentRound,
  useAgentTimeline,
} from "@frontend/app/session/agent/agent-chat-context";
import { useWindowDeactivation } from "@frontend/widgets/interactions/use-window-deactivation";
import { AGENT_SCROLL_BOTTOM_TOLERANCE_PX } from "./agent-scroll";

type AssistantEntry = Extract<AgentEntry, { kind: "assistant_message" }>;

const ROUND_HALF_WINDOW = 5;
const MAX_VISIBLE_ROUNDS = ROUND_HALF_WINDOW * 2 + 1; // 窗口上限 11 点（初始 5+1+5 居中）
const WINDOW_EDGE_MARGIN = 2; // 窗口两端预留缓冲点，触边时才推移窗口
const MIN_ROUNDS_TO_SHOW = 2;
const READING_ANCHOR_RATIO = 0.28; // 视口顶部下方阅读参考线，用于判定当前阅读回合
const TOOLTIP_SIDE_OFFSET = 10;
const PREVIEW_LINE_BREAK_SEPARATOR = " ↵ "; // 与校对表格保持同一可见换行符号

/** 滞后窗口：优先保持既有切片不变让激活点顺畅移动，仅在触及两端缓冲时推移窗口。 */
function resolve_window_start(
  previous_start: number | null,
  active_index: number,
  total: number,
): number {
  const max_start = Math.max(0, total - MAX_VISIBLE_ROUNDS);
  if (max_start === 0) return 0;
  const base = previous_start === null ? active_index - ROUND_HALF_WINDOW : previous_start;
  const min_for_active = active_index - (MAX_VISIBLE_ROUNDS - 1 - WINDOW_EDGE_MARGIN);
  const max_for_active = active_index - WINDOW_EDGE_MARGIN;
  return Math.max(0, Math.min(max_start, Math.max(min_for_active, Math.min(max_for_active, base))));
}

const ROUND_STATUS_LABEL_KEYS: Readonly<Record<AgentEntryStatus, LocaleKey>> = Object.freeze({
  running: "agent_page.status.running",
  success: "agent_page.status.success",
  error: "agent_page.status.error",
  stopped: "agent_page.status.stopped",
});

/** 按阅读参考线判定当前视口对应的回合，接近底部时固定锚定最新回合。 */
function find_active_round_id(container: HTMLElement, round_ids: readonly string[]): string | null {
  if (round_ids.length === 0) return null;
  if (
    container.scrollHeight - container.scrollTop - container.clientHeight <=
    AGENT_SCROLL_BOTTOM_TOLERANCE_PX
  ) {
    return round_ids[round_ids.length - 1] ?? null;
  }
  const container_rect = container.getBoundingClientRect();
  const anchor_y = container_rect.top + container_rect.height * READING_ANCHOR_RATIO;
  const anchors = container.querySelectorAll<HTMLElement>("[data-agent-round-id]");
  let active_id: string | null = null;
  let first_id: string | null = null;
  for (const anchor of anchors) {
    const round_id = anchor.dataset.agentRoundId;
    if (!round_id) continue;
    first_id ??= round_id;
    if (anchor.getBoundingClientRect().top <= anchor_y) {
      active_id = round_id;
    } else {
      break;
    }
  }
  return active_id ?? first_id ?? round_ids[0] ?? null;
}

/** 合并连续空行与行内多余空白，再以校对表格同款可见回车符号拼接各行。 */
function format_preview_lines(text: string): string {
  return text
    .split(/\r\n|\r|\n/u)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line !== "")
    .join(PREVIEW_LINE_BREAK_SEPARATOR);
}

/** 保留行结构轻洗常见 Markdown 标记，再走统一换行拼接管线。 */
function format_assistant_preview(text: string): string {
  const stripped = text
    .replace(/^[ \t]*```[^\n]*$/gm, "")
    .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-{3,}:?[ \t]*\|?[ \t]*$/gm, "")
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_, row: string) => row.replace(/\|/g, " "))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]*|[-*+][ \t]+|\d+\.[ \t]+)/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)\*(?=\S)|(?<=\S)\*(?=\s|$)/g, "$1");
  return format_preview_lines(stripped);
}

/** 拼接助手条目中的可见正文块，忽略思考块。 */
function extract_assistant_text(entry: AssistantEntry): string {
  const raw = entry.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text)
    .join("\n");
  return format_assistant_preview(raw);
}

type AgentRoundNavigatorProps = {
  active: boolean;
  conversation_ref: RefObject<HTMLElement | null>;
  on_jump: (round_id: string) => void;
};

/** 对话左侧回合快速定位轨：少于两个回合时不挂载任何浮层或滚动监听。 */
export function AgentRoundNavigator({
  active,
  conversation_ref,
  on_jump,
}: AgentRoundNavigatorProps): JSX.Element | null {
  const { roundIds } = useAgentTimeline();
  if (roundIds.length < MIN_ROUNDS_TO_SHOW) return null;
  return (
    <AgentRoundRail
      active={active}
      round_ids={roundIds}
      conversation_ref={conversation_ref}
      on_jump={on_jump}
    />
  );
}

/** 实际轨道只消费回合列表，悬停单点时才按需订阅该回合正文。 */
function AgentRoundRail({
  active,
  round_ids,
  conversation_ref,
  on_jump,
}: AgentRoundNavigatorProps & { round_ids: readonly string[] }): JSX.Element {
  const { t } = useI18n();
  const [handle] = useState(() => TooltipPrimitive.createHandle<string>());
  const [nav_state, set_nav_state] = useState<{
    active_id: string | null;
    window_start: number | null;
  }>({ active_id: null, window_start: null });
  const sync_frame_ref = useRef<number | null>(null);

  useWindowDeactivation(() => handle.close());

  useEffect(() => {
    if (!active) handle.close();
  }, [active, handle]);

  const sync_active_round = useCallback((): void => {
    const conversation = conversation_ref.current;
    if (!active || conversation === null) return;
    const next_active_id = find_active_round_id(conversation, round_ids);
    set_nav_state((current) => {
      const matched = next_active_id === null ? -1 : round_ids.indexOf(next_active_id);
      const next_index = matched >= 0 ? matched : round_ids.length - 1;
      const next_window_start = resolve_window_start(
        current.window_start,
        next_index,
        round_ids.length,
      );
      if (current.active_id === next_active_id && current.window_start === next_window_start) {
        return current;
      }
      return { active_id: next_active_id, window_start: next_window_start };
    });
  }, [active, conversation_ref, round_ids]);

  const schedule_sync = useCallback((): void => {
    if (sync_frame_ref.current !== null) return;
    sync_frame_ref.current = requestAnimationFrame(() => {
      sync_frame_ref.current = null;
      sync_active_round();
    });
  }, [sync_active_round]);

  useEffect(() => {
    const conversation = conversation_ref.current;
    if (!active || conversation === null) return;

    conversation.addEventListener("scroll", schedule_sync, { passive: true });
    const observer = new ResizeObserver(schedule_sync);
    observer.observe(conversation);
    if (conversation.firstElementChild !== null) observer.observe(conversation.firstElementChild);

    schedule_sync();

    return () => {
      observer.disconnect();
      conversation.removeEventListener("scroll", schedule_sync);
      if (sync_frame_ref.current !== null) {
        cancelAnimationFrame(sync_frame_ref.current);
        sync_frame_ref.current = null;
      }
    };
  }, [active, conversation_ref, schedule_sync]);

  const matched_index = nav_state.active_id === null ? -1 : round_ids.indexOf(nav_state.active_id);
  const active_index = matched_index >= 0 ? matched_index : round_ids.length - 1;
  const resolved_active_id = round_ids[active_index] ?? null;
  const start = resolve_window_start(nav_state.window_start, active_index, round_ids.length);
  const end = Math.min(round_ids.length, start + MAX_VISIBLE_ROUNDS);
  const visible_round_ids = round_ids.slice(start, end);

  return (
    <>
      <nav className="agent-round-nav" aria-label={t("agent_page.document.conversation")}>
        {visible_round_ids.map((round_id, offset) => {
          const round_number = start + offset + 1;
          const is_active = round_id === resolved_active_id;
          return (
            <TooltipPrimitive.Trigger
              key={offset} // 按固定槽位复用节点，避免窗口推移时旧激活点跨槽淡出造成反方向回闪
              handle={handle}
              payload={round_id}
              delay={0}
              closeDelay={0}
              closeOnClick={false}
              type="button"
              className="agent-round-nav__item"
              aria-label={round_number.toString()}
              aria-current={is_active ? "location" : undefined}
              data-active={is_active || undefined}
              data-round-id={round_id}
              onClick={() => on_jump(round_id)}
            >
              <span className="agent-round-nav__dot" aria-hidden="true" />
            </TooltipPrimitive.Trigger>
          );
        })}
      </nav>
      <TooltipPrimitive.Root handle={handle} disabled={!active} disableHoverablePopup>
        {({ payload }) =>
          payload === undefined ? null : (
            <TooltipPrimitive.Portal>
              <TooltipPrimitive.Positioner
                side="right"
                sideOffset={TOOLTIP_SIDE_OFFSET}
                align="center"
                collisionPadding={12}
                className="isolate max-w-(--available-width) z-(--ui-layer-tooltip) pointer-events-none [-webkit-app-region:no-drag]"
              >
                <TooltipPrimitive.Popup role="tooltip" className="agent-round-nav__tooltip">
                  <AgentRoundPreview round_id={payload} />
                </TooltipPrimitive.Popup>
              </TooltipPrimitive.Positioner>
            </TooltipPrimitive.Portal>
          )
        }
      </TooltipPrimitive.Root>
    </>
  );
}

/** 单点悬停卡片：仅订阅当前指向回合的用户输入与有效回复正文。 */
function AgentRoundPreview({ round_id }: { round_id: string }): JSX.Element | null {
  const { t } = useI18n();
  const store = useContext(AgentChatStoreContext);
  const user = useAgentEntry(round_id);
  const { entryIds, latestAssistantId } = useAgentRound(round_id);

  // 倒序寻找最近一条含非空正文的助手消息，避开纯 thinking 或工具收尾条目导致空白。
  let target_assistant_id: string | null = latestAssistantId ?? null;
  if (store !== null) {
    for (let index = entryIds.length - 1; index >= 0; index--) {
      const candidate_id = entryIds[index];
      const candidate = candidate_id === undefined ? undefined : store.timeline.entry(candidate_id);
      if (candidate?.kind === "assistant_message" && extract_assistant_text(candidate) !== "") {
        target_assistant_id = candidate.id;
        break;
      }
    }
  }
  const assistant = useAgentEntry(target_assistant_id);
  if (user?.kind !== "user_message" || user.delivery !== "round") return null;

  const user_text = format_preview_lines(user.text);
  const assistant_text =
    assistant?.kind === "assistant_message" ? extract_assistant_text(assistant) : "";

  return (
    <div className="agent-round-nav__preview">
      <p className="agent-round-nav__user" data-empty={user_text === "" || undefined}>
        {user_text || t("agent_page.queue.no_message_text")}
      </p>
      <p className="agent-round-nav__assistant" data-empty={assistant_text === "" || undefined}>
        {assistant_text || t(ROUND_STATUS_LABEL_KEYS[user.status])}
      </p>
    </div>
  );
}
