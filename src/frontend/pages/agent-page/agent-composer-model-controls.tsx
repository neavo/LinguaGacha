import type { ModelAgentLimits } from "@domain/model-agent";
import { useState, type ReactNode } from "react";
import { BookOpenText, Boxes, Brain, ChevronDown, Circle, CircleCheck } from "lucide-react";
import type { ModelThinkingLevel } from "@domain/model";
import { AGENT_COMPACTION_RESERVE_TOKENS } from "@domain/model-agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import {
  ModelSelectionCategories,
  ModelSelectionOptions,
  ModelThinkingLevelOptions,
} from "@frontend/features/model-selection/model-selection-menu";
import { MODEL_THINKING_LEVEL_LABEL_KEY } from "@frontend/features/model-selection/model-selection-meta";
import {
  read_selected_model,
  type ModelSelectionController,
} from "@frontend/features/model-selection/use-model-selection";
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
  AppDropdownMenuTrigger,
  AppDropdownMenuItem,
  AppDropdownMenuSeparator,
} from "@frontend/widgets/app-dropdown-menu";

/** 输入底栏的模型选择、上下文用量和思考档位共用一个配置控制器。 */
export function AgentComposerModelControls(props: {
  locked?: boolean;
  controller: ModelSelectionController;
  context_tokens: number | null;
  context_limits: ModelAgentLimits | null;
  on_thinking_level_change?: (level: ModelThinkingLevel) => void;
}): JSX.Element {
  const { t } = useI18n();
  // 菜单 Portal 位于输入区之外，随底部交互锁关闭并释放菜单状态。
  const [open_menu, set_open_menu] = useState<"model" | "thinking" | "batch" | null>(null);
  if (props.locked && open_menu !== null) set_open_menu(null);
  const model_controls_disabled =
    props.locked === true || props.controller.loading || props.controller.updating;
  const selected_model = read_selected_model(props.controller, "agent");
  const selected_model_name =
    selected_model?.name || selected_model?.id || t("app.model.selection.unavailable");
  const selected_thinking_available =
    selected_model !== null &&
    selected_model.available_thinking_levels.includes(selected_model.thinking_level);
  const thinking_unavailable =
    selected_model !== null && selected_model.available_thinking_levels.length === 0;
  const selected_thinking_label =
    selected_model === null
      ? null
      : selected_thinking_available
        ? t(MODEL_THINKING_LEVEL_LABEL_KEY[selected_model.thinking_level])
        : t("app.model.thinking_level.default");
  const model_selection_label = t("app.model.selection.label");
  const model_selection_aria_label = `${model_selection_label}: ${selected_model_name}`;
  // 已有会话使用实际容量，选择变化只影响下一次模型操作。
  const limits = props.context_limits ?? selected_model?.agent_limits;
  const context_usage =
    limits === undefined
      ? null
      : format_context_usage({
          tokens: props.context_tokens ?? 0,
          contextWindow: limits.context_window,
          maxTokens: limits.max_output_tokens,
        });

  const batch_model_id = props.controller.snapshot.model_selection.agent_batch_translation;
  const batch_model = props.controller.snapshot.models.find((model) => model.id === batch_model_id);
  const batch_label =
    batch_model_id === null
      ? t("agent_page.batch_translation_model.follow")
      : batch_model?.name || batch_model?.id || t("app.model.selection.unavailable");
  const batch_tooltip = t("agent_page.batch_translation_model.tooltip");
  const FollowModelIcon = batch_model_id === null ? CircleCheck : Circle;
  return (
    <>
      <ModelMenuButton
        open={open_menu === "model"}
        on_open_change={(open) => set_open_menu(open ? "model" : null)}
        disabled={model_controls_disabled}
        label={
          context_usage === null
            ? model_selection_aria_label
            : `${model_selection_aria_label} · ${context_usage.percent}`
        }
        icon={<Boxes aria-hidden="true" />}
        name={selected_model_name}
        detail={
          context_usage !== null ? (
            <>
              <span className="agent-composer__model-context-separator" aria-hidden="true">
                ·
              </span>
              <span className="agent-composer__model-context" data-tone={context_usage.tone}>
                {context_usage.percent}
              </span>
            </>
          ) : null
        }
        tooltip={
          <>
            {context_usage !== null ? (
              <p>{`${context_usage.used} / ${context_usage.total}`}</p>
            ) : null}
            {context_usage?.warning ? <p>{t("agent_page.context_usage_warning")}</p> : null}
          </>
        }
      >
        <ModelSelectionCategories
          controller={props.controller}
          usage="agent"
          disabled={model_controls_disabled}
        />
      </ModelMenuButton>
      {selected_thinking_label !== null && (
        <AppDropdownMenu
          open={open_menu === "thinking"}
          onOpenChange={(open) => set_open_menu(open ? "thinking" : null)}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex" tabIndex={thinking_unavailable ? 0 : undefined}>
                  <AppDropdownMenuTrigger
                    render={
                      <AppButton
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="agent-composer__thinking-trigger"
                        disabled={model_controls_disabled || thinking_unavailable}
                        aria-label={`${t("app.model.thinking_level.label")}: ${selected_thinking_label}`}
                      >
                        <Brain aria-hidden="true" />
                        <span>{selected_thinking_label}</span>
                        <ChevronDown aria-hidden="true" />
                      </AppButton>
                    }
                  />
                </span>
              }
            />
            <TooltipContent side="top" sideOffset={8}>
              <p>
                {thinking_unavailable
                  ? t("app.model.thinking_level.unsupported")
                  : t("app.model.thinking_level.label")}
              </p>
            </TooltipContent>
          </Tooltip>
          <AppDropdownMenuContent align="start" matchTriggerWidth={false}>
            <ModelThinkingLevelOptions
              controller={props.controller}
              usage="agent"
              disabled={model_controls_disabled}
              on_thinking_level_change={props.on_thinking_level_change}
            />
          </AppDropdownMenuContent>
        </AppDropdownMenu>
      )}

      <ModelMenuButton
        open={open_menu === "batch"}
        on_open_change={(open) => set_open_menu(open ? "batch" : null)}
        disabled={model_controls_disabled}
        label={`${batch_tooltip}: ${batch_label}`}
        icon={<BookOpenText aria-hidden="true" />}
        name={batch_label}
        tooltip={<p>{batch_tooltip}</p>}
      >
        <AppDropdownMenuItem
          aria-current={batch_model_id === null ? "true" : undefined}
          disabled={model_controls_disabled}
          onClick={() => {
            void props.controller.select_agent_batch_translation_model(null);
          }}
        >
          <FollowModelIcon aria-hidden="true" />
          <span>{t("agent_page.batch_translation_model.follow_option")}</span>
        </AppDropdownMenuItem>
        <AppDropdownMenuSeparator />
        <ModelSelectionOptions
          models={props.controller.snapshot.models}
          value={batch_model_id ?? ""}
          disabled={model_controls_disabled}
          on_select={(id) => {
            void props.controller.select_agent_batch_translation_model(id);
          }}
        />
      </ModelMenuButton>
    </>
  );
}

/** 两个模型入口共享外观与提示，菜单内容由各自选择语义组合。 */
function ModelMenuButton(props: {
  open: boolean;
  on_open_change: (open: boolean) => void;
  disabled: boolean;
  label: string;
  icon: ReactNode;
  name: string;
  detail?: ReactNode;
  tooltip: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <AppDropdownMenu open={props.open} onOpenChange={props.on_open_change}>
      <Tooltip>
        <TooltipTrigger
          render={tooltip_trigger_target(
            <AppDropdownMenuTrigger
              render={
                <AppButton
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="agent-composer__model-trigger"
                  disabled={props.disabled}
                  aria-label={props.label}
                >
                  {props.icon}
                  <span className="agent-composer__model-name">{props.name}</span>
                  {props.detail}
                  <ChevronDown aria-hidden="true" />
                </AppButton>
              }
            />,
          )}
        />
        <TooltipContent className="flex-col items-start gap-0.5" side="top" sideOffset={8}>
          {props.tooltip}
        </TooltipContent>
      </Tooltip>
      <AppDropdownMenuContent align="start" matchTriggerWidth={false}>
        {props.children}
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}

/** 一次生成上下文百分比、详情与色阶，避免组件分别重复派生。 */
function format_context_usage(usage: {
  tokens: number;
  contextWindow: number;
  maxTokens: number;
}): {
  percent: string;
  used: string;
  total: string;
  tone: "default" | "warning";
  warning: boolean;
} {
  const percent = (usage.tokens / usage.contextWindow) * 100;
  // 预警到自动压缩之间保留一份最大输出预算。
  const warning =
    usage.tokens >= usage.contextWindow - usage.maxTokens - AGENT_COMPACTION_RESERVE_TOKENS;
  return {
    percent: `${percent.toFixed(1)}%`,
    used: format_context_tokens(usage.tokens),
    total: format_context_tokens(usage.contextWindow),
    tone: warning ? "warning" : "default",
    warning,
  };
}

/** 鼠标提示中的上下文详情固定以整数 K 展示。 */
function format_context_tokens(tokens: number): string {
  return `${Math.round(tokens / 1_000).toString()}K`;
}
