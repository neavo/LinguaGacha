import type { AgentEntry, AgentEntryStatus } from "@shared/agent";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import {
  useAgentControls,
  useAgentTokenSpeed,
} from "@frontend/app/session/agent/agent-session-context";
import { useAgentElapsed } from "./agent-entry-status";

type RoundEntry = Extract<AgentEntry, { kind: "user_message"; delivery: "round" }>;

const ROUND_LABEL_KEYS: Readonly<Record<AgentEntryStatus, LocaleKey>> = Object.freeze({
  running: "agent_page.round.running",
  success: "agent_page.round.success",
  error: "agent_page.round.error",
  stopped: "agent_page.round.stopped",
});

/** 回合条目提供终态与均速，运行中的状态条持有时钟和实时速度订阅。 */
export function AgentRoundFooter({ user }: { user: RoundEntry }): JSX.Element {
  const { t } = useI18n();
  const active = user.status === "running";
  const duration = useAgentElapsed(user.createdAt, active, user.endedAt ?? undefined);
  return (
    <div className="agent-round-footer" data-running={active || undefined}>
      <span
        className={active ? "agent-round-footer__activity" : "agent-round-footer__line"}
        aria-hidden="true"
      />
      <small className="agent-round-footer__label">
        {t(ROUND_LABEL_KEYS[user.status], { duration })}
      </small>
      {active ? (
        <AgentRoundLiveSpeed round_id={user.id} />
      ) : (
        <AgentRoundSpeed speed={user.averageTokensPerSecond} />
      )}
    </div>
  );
}

/** 订阅留在实时数字内，避免速度变化重绘正文或唤醒历史回合。 */
function AgentRoundLiveSpeed({ round_id }: { round_id: string }): JSX.Element | null {
  const speed = useAgentTokenSpeed();
  const { transport } = useAgentControls();
  if (transport !== "ready" || speed?.roundId !== round_id) return null;
  return <AgentRoundSpeed speed={speed.tokensPerSecond} />;
}

/** 实时值与均速共用格式，空值连同分隔符一起省略。 */
function AgentRoundSpeed({ speed }: { speed: number | null }): JSX.Element | null {
  if (speed === null) return null;
  return (
    <small className="agent-round-footer__speed">
      <span className="agent-round-footer__speed-separator" aria-hidden="true">
        ·
      </span>
      {`${speed.toFixed(2)} T/S`}
    </small>
  );
}
