import { useEffect, useId, useState, type ReactNode, type RefObject } from "react";
import { ArrowRight, CircleQuestionMark, X } from "lucide-react";
import {
  type AgentPendingDecision,
  type AgentPendingWriteSummary,
  type AgentQuestionResponse,
  type AgentWriteApprovalDecision,
} from "@shared/agent";
import {
  AGENT_QUESTION_DEFAULT_OPTION_INDEX,
  AGENT_WRITE_APPROVAL_DEFAULT,
  type AgentDecisionCountdownSnapshot,
} from "@frontend/app/session/agent/agent-decision-countdown";
import {
  useAgentDecisionCountdown,
  useAgentSessionActions,
} from "@frontend/app/session/agent/agent-session-context";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@frontend/shadcn/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";

const AGENT_DECISION_WARNING_REMAINING_PERCENT = 25; // 最后四分之一期限切换为警告语义
const SUMMARY_COUNT_MARKER = "\uE000"; // 不会出现在本地化正文中，为数量保留独立视觉语义

/** 摘要沿业务数据顺序展示，零变化类别不进入用户决定。 */
const SUMMARY_FIELDS = [
  ["items", "agent_page.approval.summary.items"],
  ["glossary", "agent_page.approval.summary.glossary"],
  ["textPreserve", "agent_page.approval.summary.text_preserve"],
  ["preReplacement", "agent_page.approval.summary.pre_replacement"],
  ["postReplacement", "agent_page.approval.summary.post_replacement"],
  ["prompts", "agent_page.approval.summary.prompts"],
] as const satisfies readonly (readonly [keyof AgentPendingWriteSummary, LocaleKey])[];

/** 固定顺序同时定义写入授权的风险梯度和提交值。 */
const WRITE_DECISIONS = [
  ["reject", "agent_page.approval.reject"],
  ["allow_once", "agent_page.approval.allow_once"],
  ["allow_session", "agent_page.approval.allow_session"],
] as const satisfies readonly (readonly [AgentWriteApprovalDecision, LocaleKey])[];

type QuestionDecision = Extract<AgentPendingDecision, { kind: "question" }>;
type WriteDecision = Extract<AgentPendingDecision, { kind: "write_approval" }>;

/** 决策区域独立订阅时钟，页面只负责布局与离场生命周期。 */
export function AgentDecision(props: {
  decision: AgentPendingDecision;
  title_ref?: RefObject<HTMLHeadingElement | null>;
}): JSX.Element {
  const countdown = useAgentDecisionCountdown();
  const actions = useAgentSessionActions();
  // 离场期间保留旧卡片，不把新问题的时钟显示在旧卡片上。
  const current_countdown = countdown?.id === props.decision.id ? countdown : null;
  return props.decision.kind === "question" ? (
    <AgentQuestionDecision
      key={props.decision.id}
      decision={props.decision}
      title_ref={props.title_ref}
      countdown={current_countdown}
      on_focus={actions.setQuestionFocused}
      on_resolve={actions.resolveQuestion}
    />
  ) : (
    <AgentWriteDecision
      key={props.decision.id}
      decision={props.decision}
      title_ref={props.title_ref}
      countdown={current_countdown}
      on_resolve={actions.resolveWriteApproval}
    />
  );
}

/** 普通问题提供即时固定答案、显式自定义答案和取消入口。 */
function AgentQuestionDecision(props: {
  decision: QuestionDecision;
  countdown: AgentDecisionCountdownSnapshot;
  on_focus: (id: string, focused: boolean) => void;
  title_ref?: RefObject<HTMLHeadingElement | null>;
  on_resolve: (response: AgentQuestionResponse) => void;
}): JSX.Element {
  const { t } = useI18n();
  const custom_input_id = useId();
  const [custom_text, set_custom_text] = useState("");
  const custom_value = custom_text.trim();
  const {
    on_focus,
    decision: { id },
  } = props;
  // 切页卸载也释放焦点；身份校验由 Store 承担，旧卡片不会恢复新问题的计时。
  useEffect(() => () => on_focus(id, false), [id, on_focus]);

  return (
    <AgentDecisionFrame
      title={props.decision.question.prompt}
      title_ref={props.title_ref}
      description={props.decision.question.description}
      on_cancel={() => props.on_resolve({ kind: "cancel" })}
    >
      <div className="agent-decision__options">
        {props.decision.question.options.map((option, index) => (
          <AgentDecisionAction
            key={option.id}
            ordinal={index + 1}
            label={option.label}
            countdown={index === AGENT_QUESTION_DEFAULT_OPTION_INDEX ? props.countdown : null}
            onClick={() => props.on_resolve({ kind: "option", optionId: option.id })}
          />
        ))}
        <div className="agent-decision-custom">
          <label className="agent-decision-badge" htmlFor={custom_input_id}>
            {t("agent_page.decision.custom")}
          </label>
          <InputGroup className="agent-decision-custom__field">
            <InputGroupInput
              id={custom_input_id}
              value={custom_text}
              placeholder={t("agent_page.decision.custom_placeholder")}
              onFocus={() => on_focus(id, true)}
              onBlur={() => on_focus(id, false)}
              onChange={(event) => set_custom_text(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <InputGroupButton
                      className="agent-decision-icon agent-decision-custom__submit"
                      size="icon-xs"
                      disabled={custom_value === ""}
                      aria-label={t("agent_page.decision.confirm")}
                      // 保持输入框焦点，点击发送不会先恢复零秒计时。
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => {
                        if (custom_value !== "") {
                          props.on_resolve({ kind: "custom", text: custom_value });
                        }
                      }}
                    >
                      <ArrowRight aria-hidden="true" />
                    </InputGroupButton>
                  }
                />
                <TooltipContent>{t("agent_page.decision.confirm")}</TooltipContent>
              </Tooltip>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </div>
    </AgentDecisionFrame>
  );
}

/** 写入授权展示后端冻结的摘要与三种即时裁决。 */
function AgentWriteDecision(props: {
  decision: WriteDecision;
  countdown: AgentDecisionCountdownSnapshot;
  title_ref?: RefObject<HTMLHeadingElement | null>;
  on_resolve: (decision: AgentWriteApprovalDecision) => void;
}): JSX.Element {
  const { t } = useI18n();

  return (
    <AgentDecisionFrame
      title={t("agent_page.approval.title")}
      title_ref={props.title_ref}
      description={<AgentWriteSummary summary={props.decision.summary} />}
    >
      <div className="agent-decision__options">
        {WRITE_DECISIONS.map(([value, key], index) => (
          <AgentDecisionAction
            key={value}
            ordinal={index + 1}
            label={t(key)}
            countdown={value === AGENT_WRITE_APPROVAL_DEFAULT ? props.countdown : null}
            onClick={() => props.on_resolve(value)}
          />
        ))}
      </div>
    </AgentDecisionFrame>
  );
}

/** 公共框架统一标题语义、取消轨和选项内容位置。 */
function AgentDecisionFrame(props: {
  title: string;
  title_ref?: RefObject<HTMLHeadingElement | null>;
  description?: ReactNode;
  children: ReactNode;
  on_cancel?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const title_id = useId();
  const description_id = useId();

  return (
    <section
      className="agent-operation-surface agent-decision"
      aria-labelledby={title_id}
      aria-describedby={props.description === undefined ? undefined : description_id}
    >
      <header className="agent-decision__header">
        <div className="agent-decision__heading">
          <div className="agent-decision__title-line">
            <CircleQuestionMark className="agent-decision__title-icon" aria-hidden="true" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <h2
                    id={title_id}
                    ref={props.title_ref}
                    tabIndex={-1}
                    className="agent-decision__prompt"
                  />
                }
              >
                {props.title}
              </TooltipTrigger>
              <TooltipContent>{props.title}</TooltipContent>
            </Tooltip>
          </div>
          {props.description === undefined ? null : (
            <Tooltip>
              <TooltipTrigger
                render={<div id={description_id} className="agent-decision__description" />}
              >
                {props.description}
              </TooltipTrigger>
              <TooltipContent>{props.description}</TooltipContent>
            </Tooltip>
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
      <div className="agent-decision__body">{props.children}</div>
    </section>
  );
}

/** 决策动作统一承载序号、标签和可选期限进度。 */
function AgentDecisionAction({
  ordinal,
  label,
  countdown,
  onClick,
}: {
  ordinal: number;
  label: string;
  countdown: AgentDecisionCountdownSnapshot;
  onClick: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const remaining_label =
    countdown === null
      ? null
      : t(
          countdown.paused
            ? "agent_page.decision.paused_remaining"
            : "agent_page.decision.remaining",
          {
            time: format_remaining_time(countdown.remainingSeconds),
          },
        );
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" onClick={onClick} className="agent-decision-action" />}
      >
        <span className="agent-decision-badge" aria-hidden="true">
          {ordinal}
        </span>
        <span className="agent-decision-action__label">{label}</span>
        <span
          className={`agent-decision-icon agent-decision-action__icon${
            countdown === null ? "" : " agent-decision-action__icon--deadline"
          }`}
          data-warning={
            countdown !== null &&
            countdown.remainingPercent <= AGENT_DECISION_WARNING_REMAINING_PERCENT
              ? "true"
              : undefined
          }
          aria-hidden={countdown === null ? "true" : undefined}
        >
          {countdown === null ? null : (
            <svg className="agent-decision-progress" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="agent-decision-progress__track" cx="12" cy="12" r="10.75" />
              <circle
                className="agent-decision-progress__value"
                cx="12"
                cy="12"
                r="10.75"
                pathLength="100"
                style={{ strokeDashoffset: 100 - countdown.remainingPercent }}
              />
            </svg>
          )}
          <ArrowRight className="agent-decision-action__arrow" aria-hidden="true" />
          {remaining_label === null ? null : <span className="sr-only">{remaining_label}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span>
          {label}
          {remaining_label === null ? null : (
            <>
              <br />
              {remaining_label}
            </>
          )}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/** 按当前 locale 投影非零变更类别。 */
function AgentWriteSummary(props: { summary: AgentPendingWriteSummary }): JSX.Element {
  const { locale, t } = useI18n();

  return (
    <ul className="agent-write-summary">
      {SUMMARY_FIELDS.filter(([field]) => props.summary[field] > 0).map(([field, key]) => {
        const [before, after] = t(key, { count: SUMMARY_COUNT_MARKER }).split(SUMMARY_COUNT_MARKER);
        return (
          <li key={field} className="agent-write-summary__item">
            {before === "" ? null : <span>{before}</span>}
            <span className="agent-write-summary__value">
              {props.summary[field].toLocaleString(locale)}
            </span>
            {after === "" ? null : <span>{after}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** 倒计时固定为便于快速扫读的分秒格式。 */
function format_remaining_time(remaining_seconds: number): string {
  const minutes = Math.floor(remaining_seconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (remaining_seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
