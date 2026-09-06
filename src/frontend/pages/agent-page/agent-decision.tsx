import { useEffect, useId, useState, type ReactNode, type RefObject } from "react";
import { ArrowRight, CircleQuestionMark, X } from "lucide-react";
import {
  AGENT_DECISION_TIMEOUT_MS,
  AGENT_QUESTION_DEFAULT_OPTION_INDEX,
  AGENT_WRITE_APPROVAL_DEFAULT,
  type AgentPendingDecision,
  type AgentPendingWriteSummary,
  type AgentQuestionResponse,
  type AgentWriteApprovalDecision,
} from "@shared/agent";
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

/** 后端绝对期限在当前渲染帧中的只读展示投影。 */
type AgentDecisionDeadline = Readonly<{
  remaining_seconds: number;
  remaining_percent: number;
  warning: boolean;
}>;

/** 决定内容在底部交互区内占位，布局与离场生命周期由页面持有。 */
export function AgentDecision(props: {
  decision: AgentPendingDecision;
  title_ref?: RefObject<HTMLHeadingElement | null>;
  on_resolve_question: (response: AgentQuestionResponse) => void;
  on_resolve_write_approval: (decision: AgentWriteApprovalDecision) => void;
}): JSX.Element {
  return props.decision.kind === "question" ? (
    <AgentQuestionDecision
      key={props.decision.id}
      decision={props.decision}
      title_ref={props.title_ref}
      on_resolve={props.on_resolve_question}
    />
  ) : (
    <AgentWriteDecision
      key={props.decision.id}
      decision={props.decision}
      title_ref={props.title_ref}
      on_resolve={props.on_resolve_write_approval}
    />
  );
}

/** 普通问题提供即时固定答案、显式自定义答案和取消入口。 */
function AgentQuestionDecision(props: {
  decision: QuestionDecision;
  title_ref?: RefObject<HTMLHeadingElement | null>;
  on_resolve: (response: AgentQuestionResponse) => void;
}): JSX.Element {
  const { t } = useI18n();
  const custom_input_id = useId();
  const [custom_text, set_custom_text] = useState("");
  const custom_value = custom_text.trim();

  return (
    <AgentDecisionFrame
      title={props.decision.question.prompt}
      title_ref={props.title_ref}
      description={props.decision.question.description}
      expires_at={props.decision.expiresAt}
      on_cancel={() => props.on_resolve({ kind: "cancel" })}
    >
      {(deadline) => (
        <div className="agent-decision__options">
          {props.decision.question.options.map((option, index) => (
            <AgentDecisionAction
              key={option.id}
              ordinal={index + 1}
              label={option.label}
              deadline={index === AGENT_QUESTION_DEFAULT_OPTION_INDEX ? deadline : undefined}
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
      )}
    </AgentDecisionFrame>
  );
}

/** 写入授权展示后端冻结的摘要与三种即时裁决。 */
function AgentWriteDecision(props: {
  decision: WriteDecision;
  title_ref?: RefObject<HTMLHeadingElement | null>;
  on_resolve: (decision: AgentWriteApprovalDecision) => void;
}): JSX.Element {
  const { t } = useI18n();

  return (
    <AgentDecisionFrame
      title={t("agent_page.approval.title")}
      title_ref={props.title_ref}
      description={<AgentWriteSummary summary={props.decision.summary} />}
      expires_at={props.decision.expiresAt}
    >
      {(deadline) => (
        <div className="agent-decision__options">
          {WRITE_DECISIONS.map(([value, key], index) => (
            <AgentDecisionAction
              key={value}
              ordinal={index + 1}
              label={t(key)}
              deadline={value === AGENT_WRITE_APPROVAL_DEFAULT ? deadline : undefined}
              onClick={() => props.on_resolve(value)}
            />
          ))}
        </div>
      )}
    </AgentDecisionFrame>
  );
}

/** 公共框架统一标题语义、期限刷新、取消轨和选项内容位置。 */
function AgentDecisionFrame(props: {
  title: string;
  title_ref?: RefObject<HTMLHeadingElement | null>;
  description?: ReactNode;
  expires_at: number;
  children: (deadline: AgentDecisionDeadline) => ReactNode;
  on_cancel?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const title_id = useId();
  const description_id = useId();
  const [remaining_seconds, set_remaining_seconds] = useState(() =>
    read_remaining_seconds(props.expires_at),
  );

  useEffect(() => {
    // 剩余时间由后端绝对期限计算，计时器只负责触发重绘。
    const update = (): void => set_remaining_seconds(read_remaining_seconds(props.expires_at));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
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
    <section
      className="agent-operation-surface agent-decision"
      aria-labelledby={title_id}
      aria-describedby={props.description === undefined ? undefined : description_id}
    >
      <header className="agent-decision__header">
        <div className="agent-decision__heading">
          <div className="agent-decision__title-line">
            <CircleQuestionMark className="agent-decision__title-icon" aria-hidden="true" />
            <h2
              id={title_id}
              ref={props.title_ref}
              tabIndex={-1}
              className="agent-decision__prompt"
            >
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
  );
}

/** 决策动作统一承载序号、标签和可选期限进度。 */
function AgentDecisionAction({
  ordinal,
  label,
  deadline,
  onClick,
}: {
  ordinal: number;
  label: string;
  deadline?: AgentDecisionDeadline;
  onClick: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const remaining_label =
    deadline === undefined
      ? null
      : t("agent_page.decision.remaining", {
          time: format_remaining_time(deadline.remaining_seconds),
        });
  return (
    <button type="button" onClick={onClick} className="agent-decision-action">
      <span className="agent-decision-badge" aria-hidden="true">
        {ordinal}
      </span>
      <span className="agent-decision-action__label">{label}</span>
      <span
        className={`agent-decision-icon agent-decision-action__icon${
          deadline === undefined ? "" : " agent-decision-action__icon--deadline"
        }`}
        data-warning={deadline?.warning ? "true" : undefined}
        aria-hidden={deadline === undefined ? "true" : undefined}
      >
        {deadline === undefined ? null : (
          <svg className="agent-decision-progress" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="agent-decision-progress__track" cx="12" cy="12" r="10.75" />
            <circle
              className="agent-decision-progress__value"
              cx="12"
              cy="12"
              r="10.75"
              pathLength="100"
              style={{ strokeDashoffset: 100 - deadline.remaining_percent }}
            />
          </svg>
        )}
        <ArrowRight className="agent-decision-action__arrow" aria-hidden="true" />
        {remaining_label === null ? null : <span className="sr-only">{remaining_label}</span>}
      </span>
    </button>
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
