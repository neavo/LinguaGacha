import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowRight, X, type LucideIcon } from "lucide-react";

import { AGENT_DECISION_TIMEOUT_MS } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";

const AGENT_DECISION_WARNING_REMAINING_PERCENT = 25; // 最后四分之一期限切换为警告语义

type AgentDecisionOverlayProps = {
  title: string;
  TitleIcon: LucideIcon;
  description?: ReactNode;
  expires_at: number;
  children: (deadline: AgentDecisionDeadline) => ReactNode;
  on_cancel?: () => void;
};

type AgentDecisionDeadline = Readonly<{
  remaining_seconds: number;
  remaining_percent: number;
  warning: boolean;
}>;

/** pending 清除前封住重复裁决；提交失败时重新开放仍可见的决定。 */
export function useAgentDecisionSubmit<TDecision>(
  on_resolve: (decision: TDecision) => Promise<void>,
): (decision: TDecision) => void {
  const submitted_ref = useRef(false);
  return useCallback(
    (decision: TDecision) => {
      if (submitted_ref.current) return;
      submitted_ref.current = true;
      void on_resolve(decision).catch(() => {
        submitted_ref.current = false;
      });
    },
    [on_resolve],
  );
}

/** 局部决策层只覆盖 Agent 底部控制区，对话时间线仍可阅读。 */
export function AgentDecisionOverlay(props: AgentDecisionOverlayProps): JSX.Element {
  const { t } = useI18n();
  const title_id = useId();
  const description_id = useId();
  const title_ref = useRef<HTMLHeadingElement | null>(null);
  const [remaining_seconds, set_remaining_seconds] = useState(() =>
    read_remaining_seconds(props.expires_at),
  );

  useEffect(() => {
    const previous_focus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    title_ref.current?.focus();
    const update = (): void => set_remaining_seconds(read_remaining_seconds(props.expires_at));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => {
      window.clearInterval(timer);
      if (previous_focus?.isConnected === true) previous_focus.focus();
    };
  }, [props.expires_at]);

  const remaining_percent = Math.min(
    100,
    (remaining_seconds / (AGENT_DECISION_TIMEOUT_MS / 1_000)) * 100,
  );
  const deadline: AgentDecisionDeadline = {
    remaining_seconds,
    remaining_percent,
    warning: remaining_percent <= AGENT_DECISION_WARNING_REMAINING_PERCENT,
  };

  return (
    <div className="agent-decision-layer">
      <div className="agent-decision-shade">
        <section
          className="agent-operation-surface agent-decision"
          role="dialog"
          aria-labelledby={title_id}
          aria-describedby={props.description === undefined ? undefined : description_id}
        >
          <header className="agent-decision__header">
            <div className="agent-decision__heading">
              <div className="agent-decision__title-line">
                <props.TitleIcon className="agent-decision__title-icon" aria-hidden="true" />
                <h2 id={title_id} ref={title_ref} tabIndex={-1} className="agent-decision__prompt">
                  {props.title}
                </h2>
              </div>
              {props.description === undefined ? null : (
                <div id={description_id} className="agent-decision__description">
                  {props.description}
                </div>
              )}
            </div>
            <div className="agent-decision__header-actions">
              {props.on_cancel === undefined ? null : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <AppButton
                        type="button"
                        className="agent-decision-icon agent-decision__cancel"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("agent_page.decision.cancel")}
                        onClick={props.on_cancel}
                      >
                        <X aria-hidden="true" />
                      </AppButton>
                    }
                  />
                  <TooltipContent>{t("agent_page.decision.cancel")}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </header>
          <div className="agent-decision__body">{props.children(deadline)}</div>
        </section>
      </div>
    </div>
  );
}

/** 决策动作统一承载序号、标签和可选期限进度。 */
export function AgentDecisionAction(props: {
  ordinal: number;
  label: string;
  deadline?: AgentDecisionDeadline;
  on_select: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const remaining_label =
    props.deadline === undefined
      ? null
      : t("agent_page.decision.remaining", {
          time: format_remaining_time(props.deadline.remaining_seconds),
        });
  return (
    <button type="button" className="agent-decision-action" onClick={props.on_select}>
      <span className="agent-decision-badge" aria-hidden="true">
        {props.ordinal}
      </span>
      <span className="agent-decision-action__label">{props.label}</span>
      <span
        className={`agent-decision-icon agent-decision-action__icon${
          props.deadline === undefined ? "" : " agent-decision-action__icon--deadline"
        }`}
        data-warning={props.deadline?.warning ? "true" : undefined}
        aria-hidden={props.deadline === undefined ? "true" : undefined}
      >
        {props.deadline === undefined ? null : (
          <svg className="agent-decision-progress" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="agent-decision-progress__track" cx="12" cy="12" r="10.75" />
            <circle
              className="agent-decision-progress__value"
              cx="12"
              cy="12"
              r="10.75"
              pathLength="100"
              style={{ strokeDashoffset: 100 - props.deadline.remaining_percent }}
            />
          </svg>
        )}
        <ArrowRight className="agent-decision-action__arrow" aria-hidden="true" />
        {remaining_label === null ? null : <span className="sr-only">{remaining_label}</span>}
      </span>
    </button>
  );
}

/** 向上取整避免后端期限到达前提前显示为零。 */
function read_remaining_seconds(expires_at: number): number {
  return Math.max(0, Math.ceil((expires_at - Date.now()) / 1_000));
}

/** 倒计时固定为便于快速扫读的分秒格式。 */
function format_remaining_time(remaining_seconds: number): string {
  const minutes = Math.floor(remaining_seconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (remaining_seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
