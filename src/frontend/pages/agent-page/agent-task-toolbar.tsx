import {
  ChevronDown,
  FileOutput,
  MessageSquarePlus,
  ShieldCheck,
  ShieldQuestionMark,
  WifiOff,
} from "lucide-react";
import type { ModelThinkingLevel } from "@domain/model";
import type { AgentApprovalMode, AgentContextSnapshot } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { useTranslationExport } from "@frontend/app/session/translation-export/translation-export-context";
import type { ModelSelectionController } from "@frontend/features/model-selection/use-model-selection";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  tooltip_trigger_target,
} from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuRadioGroup,
  AppDropdownMenuRadioItem,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";
import { resolve_shortcut_platform } from "@frontend/widgets/interactions/keyboard-shortcuts";
import { ShortcutTooltipRow } from "@frontend/widgets/interactions/shortcut-kbd";
import { useActionShortcut } from "@frontend/widgets/interactions/use-action-shortcut";
import { AgentComposerModelControls } from "./agent-composer-model-controls";

/** 任务设置独立于编辑锁，模型菜单自行管理配置请求期间的可用性。 */
export function AgentTaskToolbar(props: {
  can_reset: boolean;
  context: AgentContextSnapshot;
  model_selection: ModelSelectionController;
  approval_mode: AgentApprovalMode;
  approval_disabled: boolean;
  disconnected: boolean;
  on_reset: () => void;
  on_thinking_level_change?: (level: ModelThinkingLevel) => void;
  on_approval_mode_change?: (mode: AgentApprovalMode) => void;
}): JSX.Element {
  const { t } = useI18n();
  const translation_export = useTranslationExport();
  const new_task_aria_shortcut = resolve_shortcut_platform() === "mac" ? "Meta+N" : "Control+N";
  useActionShortcut({
    action: "create",
    enabled: props.can_reset,
    allow_in_text_editing: true,
    on_trigger: props.on_reset,
  });
  const approval_mode_label = t(
    props.approval_mode === "auto" ? "agent_page.approval.auto" : "agent_page.approval.manual",
  );
  const ApprovalModeIcon = props.approval_mode === "auto" ? ShieldCheck : ShieldQuestionMark;
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={tooltip_trigger_target(
            <AppButton
              type="button"
              size="sm"
              variant="ghost"
              className="agent-composer__reset"
              disabled={!props.can_reset}
              aria-keyshortcuts={props.can_reset ? new_task_aria_shortcut : undefined}
              onClick={props.on_reset}
            >
              <MessageSquarePlus aria-hidden="true" />
              <span>{t("agent_page.action.new_task")}</span>
            </AppButton>,
          )}
        />
        <TooltipContent side="top" sideOffset={8}>
          {props.can_reset ? (
            <ShortcutTooltipRow label={t("agent_page.action.new_task")} shortcut="create" />
          ) : (
            <p>{t("agent_page.action.new_task")}</p>
          )}
        </TooltipContent>
      </Tooltip>
      <AppButton
        type="button"
        size="sm"
        variant="ghost"
        className="agent-composer__export"
        disabled={!translation_export.can_request_export}
        onClick={translation_export.request_export}
      >
        <FileOutput aria-hidden="true" />
        <span>{t("workbench_page.action.generate_translation")}</span>
      </AppButton>
      {props.disconnected ? (
        <span
          className="agent-composer__connection-status"
          role="status"
          title={t("agent_page.error.connection")}
        >
          <WifiOff className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{t("agent_page.error.connection")}</span>
        </span>
      ) : null}
      <AgentComposerModelControls
        controller={props.model_selection}
        context_tokens={props.context.tokens}
        context_limits={props.context.limits}
        on_thinking_level_change={props.on_thinking_level_change}
      />
      <AppDropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={tooltip_trigger_target(
              <AppDropdownMenuTrigger
                render={
                  <AppButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="agent-composer__approval-trigger"
                    data-approval-mode={props.approval_mode}
                    disabled={props.approval_disabled}
                    aria-label={approval_mode_label}
                  >
                    <ApprovalModeIcon
                      className="agent-composer__approval-icon"
                      aria-hidden="true"
                    />
                    <span className="agent-composer__approval-label">{approval_mode_label}</span>
                    <ChevronDown aria-hidden="true" />
                  </AppButton>
                }
              />,
            )}
          />
          <TooltipContent side="top" sideOffset={8}>
            <p>{t("agent_page.approval.tooltip")}</p>
          </TooltipContent>
        </Tooltip>
        <AppDropdownMenuContent align="end" matchTriggerWidth={false}>
          <AppDropdownMenuRadioGroup
            value={props.approval_mode}
            onValueChange={(value) => {
              if (!props.approval_disabled && (value === "manual" || value === "auto")) {
                props.on_approval_mode_change?.(value);
              }
            }}
          >
            <AppDropdownMenuRadioItem value="manual" disabled={props.approval_disabled}>
              <ShieldQuestionMark aria-hidden="true" />
              {t("agent_page.approval.manual")}
            </AppDropdownMenuRadioItem>
            <AppDropdownMenuRadioItem value="auto" disabled={props.approval_disabled}>
              <ShieldCheck aria-hidden="true" />
              {t("agent_page.approval.auto")}
            </AppDropdownMenuRadioItem>
          </AppDropdownMenuRadioGroup>
        </AppDropdownMenuContent>
      </AppDropdownMenu>
    </>
  );
}
