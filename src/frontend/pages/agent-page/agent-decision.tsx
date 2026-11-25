import { badgeVariants } from "@frontend/shadcn/badge-variants";
import {
  type JSX,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ArrowRight, CircleQuestionMark, X } from "lucide-react";
import type {
  AgentPendingDecision,
  AgentPendingWriteSummary,
  AgentQuestionResponse,
  AgentWriteApprovalDecision,
} from "@shared/agent";
import {
  AGENT_QUESTION_DEFAULT_OPTION_INDEX,
  AGENT_WRITE_APPROVAL_DEFAULT,
  type AgentDecisionCountdownSnapshot,
} from "@frontend/app/session/agent/agent-decision-countdown";
import {
  useAgentDecisionCountdown,
  useAgentChatActions,
} from "@frontend/app/session/agent/agent-chat-context";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-context";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@frontend/shadcn/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import { CountdownRing } from "@frontend/widgets/countdown-ring/countdown-ring";
import {
  get_shortcut_aria_keys,
  is_element_text_editing_target,
} from "@frontend/widgets/interactions/keyboard-shortcuts";
import { ShortcutTooltipRow } from "@frontend/widgets/interactions/shortcut-kbd";

const SUMMARY_COUNT_MARKER = "\uE000"; // 不会出现在本地化正文中，为数量保留独立视觉语义

/** 摘要沿业务数据顺序展示，零变化类别不进入用户决定。 */
const SUMMARY_FIELDS = [
  ["files", "agent_page.approval.summary.files"],
  ["items", "agent_page.approval.summary.items"],
  ["glossary", "agent_page.approval.summary.glossary"],
  ["textPreserve", "agent_page.approval.summary.text_preserve"],
  ["preReplacement", "agent_page.approval.summary.pre_replacement"],
  ["postReplacement", "agent_page.approval.summary.post_replacement"],
  ["knowledge", "agent_page.approval.summary.knowledge"],
  ["prompts", "agent_page.approval.summary.prompts"],
] as const satisfies readonly (readonly [keyof AgentPendingWriteSummary, LocaleKey])[];

/** 固定顺序同时定义写入授权的风险梯度和提交值。 */
const WRITE_DECISIONS = [
  ["reject", "agent_page.approval.reject"],
  ["allow_once", "agent_page.approval.allow_once"],
] as const satisfies readonly (readonly [AgentWriteApprovalDecision, LocaleKey])[];

type QuestionDecision = Extract<AgentPendingDecision, { kind: "question" }>;

const OPEN_OVERLAY_SELECTOR =
  ':is([role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]):not([data-closed])';

/** 菜单打开时焦点可以留在触发器上，因此按文档查找仍可交互的浮层。 */
function has_open_overlay(): boolean {
  for (const overlay of document.querySelectorAll(OPEN_OVERLAY_SELECTOR)) {
    if (overlay.closest("[inert], [hidden]") === null) return true;
  }
  return false;
}

/** 输入法组字和带修饰键的操作交给当前输入目标。 */
function is_plain_key(event: KeyboardEvent, key: "Enter" | "Escape"): boolean {
  return (
    event.key === key &&
    !event.isComposing &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

/** 决策卡片独立订阅时钟，并统一处理键盘与鼠标取消。 */
export function AgentDecision({
  decision,
  active,
  title_ref,
}: {
  decision: AgentPendingDecision;
  active: boolean;
  title_ref?: RefObject<HTMLHeadingElement | null>;
}): JSX.Element {
  const { t } = useI18n();
  const countdown = useAgentDecisionCountdown();
  const actions = useAgentChatActions();
  const custom_input_ref = useRef<HTMLInputElement | null>(null);
  const current_countdown = countdown?.id === decision.id ? countdown : null; // 离场卡片只显示自己的倒计时。

  /** 按卡片类型提交其取消裁决。 */
  const cancel = (): void => {
    if (decision.kind === "question") void actions.resolveQuestion({ kind: "cancel" });
    else void actions.resolveWriteApproval("reject");
  };

  /** 输入框先失焦，上层浮层与其他编辑器保留各自的 Esc 行为。 */
  const handle_escape = useEffectEvent((event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.repeat || !is_plain_key(event, "Escape")) return;
    if (has_open_overlay()) return;
    const input = custom_input_ref.current;
    if (input !== null && event.target === input) {
      event.preventDefault();
      input.blur();
      return;
    }
    if (event.target instanceof Element && is_element_text_editing_target(event.target)) return;
    event.preventDefault();
    cancel();
  });

  useEffect(() => {
    if (!active) return;
    // 在 Tooltip 拦截 Esc 前处理卡片快捷键。
    window.addEventListener("keydown", handle_escape, true);
    return () => window.removeEventListener("keydown", handle_escape, true);
  }, [active]);

  const heading =
    decision.kind === "question"
      ? { title: decision.question.prompt, description: decision.question.description }
      : {
          title: t("agent_page.approval.title"),
          description: <AgentWriteSummary summary={decision.summary} />,
        };

  return (
    <AgentDecisionFrame key={decision.id} {...heading} title_ref={title_ref} on_cancel={cancel}>
      {decision.kind === "question" ? (
        <AgentQuestionOptions
          decision={decision}
          input_ref={custom_input_ref}
          countdown={current_countdown}
          on_focus={actions.setQuestionFocused}
          on_resolve={actions.resolveQuestion}
        />
      ) : (
        <AgentWriteOptions
          countdown={current_countdown}
          on_resolve={actions.resolveWriteApproval}
        />
      )}
    </AgentDecisionFrame>
  );
}

/** 固定选项立即提交，自定义答案在输入时暂停倒计时。 */
function AgentQuestionOptions(props: {
  decision: QuestionDecision;
  countdown: AgentDecisionCountdownSnapshot;
  on_focus: (id: string, focused: boolean) => void;
  input_ref: RefObject<HTMLInputElement | null>;
  on_resolve: (response: AgentQuestionResponse) => void;
}): JSX.Element {
  const { t } = useI18n();
  const custom_input_id = useId();
  const [custom_text, set_custom_text] = useState("");
  const custom_value = custom_text.trim();
  const can_submit = custom_value !== "";
  const {
    on_focus,
    decision: { id },
  } = props;
  // 切页卸载也释放焦点；身份校验由 Store 承担，旧卡片不会恢复新问题的计时。
  useEffect(() => () => on_focus(id, false), [id, on_focus]);

  /** 点击与回车共用答案校验，提交互斥和倒计时停止由会话状态处理。 */
  const submit_custom_answer = (): void => {
    if (can_submit) props.on_resolve({ kind: "custom", text: custom_value });
  };

  return (
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
        <label
          className={badgeVariants({ className: "agent-decision-badge" })}
          htmlFor={custom_input_id}
        >
          {t("agent_page.decision.custom")}
        </label>
        <InputGroup className="agent-decision-custom__field">
          <InputGroupInput
            ref={props.input_ref}
            id={custom_input_id}
            value={custom_text}
            placeholder={t("agent_page.decision.custom_placeholder")}
            onFocus={() => on_focus(id, true)}
            onBlur={() => on_focus(id, false)}
            onChange={(event) => set_custom_text(event.target.value)}
            onKeyDown={(event) => {
              if (!is_plain_key(event.nativeEvent, "Enter")) return;
              event.preventDefault();
              submit_custom_answer();
            }}
          />
          <InputGroupAddon align="inline-end">
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupButton
                    className="agent-decision-icon agent-decision-custom__submit"
                    size="icon-xs"
                    disabled={!can_submit}
                    aria-label={t("app.action.confirm")}
                    aria-keyshortcuts="Enter"
                    // 保持输入框焦点，点击发送不会先恢复零秒计时。
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={submit_custom_answer}
                  >
                    <ArrowRight aria-hidden="true" />
                  </InputGroupButton>
                }
              />
              <TooltipContent>
                <ShortcutTooltipRow label={t("app.action.confirm")} shortcut="submit" />
              </TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  );
}

/** 审批选项提交当前批次的裁决，倒计时只标记默认选项。 */
function AgentWriteOptions(props: {
  countdown: AgentDecisionCountdownSnapshot;
  on_resolve: (decision: AgentWriteApprovalDecision) => void;
}): JSX.Element {
  const { t } = useI18n();

  return (
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
  );
}

/** 公共框架统一组织标题、说明、取消按钮和内容区域。 */
function AgentDecisionFrame(props: {
  title: string;
  title_ref?: RefObject<HTMLHeadingElement | null> | undefined;
  description?: ReactNode;
  children: ReactNode;
  on_cancel: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const cancel_label = t("app.action.cancel");
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
          <Tooltip>
            <TooltipTrigger
              render={
                <AppButton
                  type="button"
                  className="agent-decision-icon agent-decision__cancel"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={cancel_label}
                  aria-keyshortcuts={get_shortcut_aria_keys("cancel")}
                  onClick={props.on_cancel}
                >
                  <X aria-hidden="true" />
                </AppButton>
              }
            />
            <TooltipContent>
              <ShortcutTooltipRow label={cancel_label} shortcut="cancel" />
            </TooltipContent>
          </Tooltip>
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
      : t("agent_page.decision.remaining", {
          time: format_remaining_time(countdown.remainingSeconds),
        });
  const arrow = <ArrowRight className="agent-decision-action__arrow" aria-hidden="true" />;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" onClick={onClick} className="agent-decision-action" />}
      >
        <span className={badgeVariants({ className: "agent-decision-badge" })} aria-hidden="true">
          {ordinal}
        </span>
        <span className="agent-decision-action__label">{label}</span>
        {countdown === null ? (
          <span className="agent-decision-icon agent-decision-action__icon" aria-hidden="true">
            {arrow}
          </span>
        ) : (
          <CountdownRing
            className="agent-decision-action__icon"
            remaining_percent={countdown.remainingPercent}
          >
            {arrow}
            <span className="sr-only">{remaining_label}</span>
          </CountdownRing>
        )}
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

/** 按当前语言格式显示非零变更类别。 */
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
