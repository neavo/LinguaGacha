import { useEffect, useEffectEvent } from "react";
import { ChevronDown, ShieldQuestionMark } from "lucide-react";

import type { AgentPendingWriteSummary } from "@shared/agent";
import { useI18n, type LocaleKey } from "@frontend/app/locale/locale-provider";
import { AppButton } from "@frontend/widgets/app-button";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import { ShortcutKbd } from "@frontend/widgets/interactions/shortcut-kbd";

/** 用不会出现在本地化正文中的标记，把计数插回翻译前后文。 */
const APPROVAL_COUNT_MARKER = "\uE000";
/** 完整句式保留给 locale，组件只在摘要占位处插入带高亮的结构化计数。 */
const APPROVAL_SUMMARY_MARKER = "\uE001";
/** 摘要字段顺序与公开 pending summary 保持一致，文案仍由 locale 拥有。 */
const APPROVAL_SUMMARY_FIELDS = [
  ["items", "agent_page.approval.summary_items"],
  ["glossary", "agent_page.approval.summary_glossary"],
  ["textPreserve", "agent_page.approval.summary_text_preserve"],
  ["preReplacement", "agent_page.approval.summary_pre_replacement"],
  ["postReplacement", "agent_page.approval.summary_post_replacement"],
  ["prompts", "agent_page.approval.summary_prompts"],
] as const satisfies readonly (readonly [keyof AgentPendingWriteSummary, LocaleKey])[];

/** 审批面只接收后端摘要和公开决策回调，不持有写入或会话状态。 */
type AgentApprovalPanelProps = {
  summary: AgentPendingWriteSummary;
  on_approve: (switch_to_auto: boolean) => void;
  on_reject: () => void;
};

/** 待审批写入独占 Composer 槽位；摘要、快捷键和决策行为不进入输入器。 */
export function AgentApprovalPanel(props: AgentApprovalPanelProps): JSX.Element {
  const { t } = useI18n();
  const approve_once = useEffectEvent(() => props.on_approve(false));
  const reject = useEffectEvent(props.on_reject);

  useEffect(() => {
    const handle_keydown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (
        target !== null &&
        target.closest(
          "[role='menu'], [role='dialog'], [role='alertdialog'], input, textarea, select, [contenteditable='true']",
        ) !== null
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        reject();
      } else if (event.key === "Enter" && (target === null || target.closest("button") === null)) {
        event.preventDefault();
        approve_once();
      }
    };
    window.addEventListener("keydown", handle_keydown);
    return () => window.removeEventListener("keydown", handle_keydown);
  }, []);

  const summary_parts = APPROVAL_SUMMARY_FIELDS.map(([field, key], index) => {
    const count = props.summary[field];
    const [before, after] = t(key, { count: APPROVAL_COUNT_MARKER }).split(APPROVAL_COUNT_MARKER);
    const separator =
      index === APPROVAL_SUMMARY_FIELDS.length - 1
        ? ""
        : t(
            index === APPROVAL_SUMMARY_FIELDS.length - 2
              ? "agent_page.approval.summary_last_separator"
              : "agent_page.approval.summary_separator",
          );
    return (
      <span key={field}>
        {before}
        <span
          className="agent-approval__change-count"
          data-changed={count > 0 ? "true" : undefined}
        >
          {count}
        </span>
        {after}
        {separator}
      </span>
    );
  });
  const [description_before, description_after] = t("agent_page.approval.description", {
    summary: APPROVAL_SUMMARY_MARKER,
  }).split(APPROVAL_SUMMARY_MARKER);

  return (
    <section
      className="agent-operation-surface agent-approval"
      aria-labelledby="agent-approval-description"
    >
      <p id="agent-approval-description" className="agent-approval__description">
        <span className="agent-approval__description-icon" aria-hidden="true">
          <ShieldQuestionMark />
        </span>
        <span className="agent-approval__description-text">
          {description_before}
          {summary_parts}
          {description_after}
        </span>
      </p>
      <div className="agent-approval__actions">
        <AppButton
          type="button"
          size="sm"
          variant="outline"
          aria-keyshortcuts="Escape"
          onClick={props.on_reject}
        >
          {t("agent_page.approval.reject")}
          <ShortcutKbd action="cancel" />
        </AppButton>
        <div className="agent-approval__split">
          <AppButton
            type="button"
            size="sm"
            variant="default"
            aria-keyshortcuts="Enter"
            onClick={() => props.on_approve(false)}
          >
            {t("agent_page.approval.approve_once")}
            <ShortcutKbd action="submit" className="bg-background/18 text-primary-foreground" />
          </AppButton>
          <AppDropdownMenu>
            <AppDropdownMenuTrigger
              render={
                <AppButton
                  type="button"
                  size="icon-sm"
                  variant="default"
                  aria-label={t("agent_page.approval.approve_future")}
                >
                  <ChevronDown aria-hidden="true" />
                </AppButton>
              }
            />
            <AppDropdownMenuContent align="end" matchTriggerWidth={false}>
              <AppDropdownMenuItem onClick={() => props.on_approve(true)}>
                {t("agent_page.approval.approve_future")}
              </AppDropdownMenuItem>
            </AppDropdownMenuContent>
          </AppDropdownMenu>
        </div>
      </div>
    </section>
  );
}
