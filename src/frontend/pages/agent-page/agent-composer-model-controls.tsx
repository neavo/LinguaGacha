import { type ModelAgentLimits, AGENT_COMPACTION_RESERVE_TOKENS } from "@domain/model-agent";
import { Fragment, type JSX, useState, type ReactNode } from "react";
import { Network, Bot, ChevronDown } from "lucide-react";
import type { ModelSelectionInput } from "@shared/model-selection";
import type { AgentUsageSnapshot } from "@shared/agent";

import { useI18n } from "@frontend/app/locale/locale-context";
import { ModelSelectionOptions } from "@frontend/features/model-selection/model-selection-menu";
import { MODEL_THINKING_LEVEL_LABEL_KEY } from "@frontend/features/model-selection/model-selection-meta";
import {
  read_selected_model,
  type ModelSelectionController,
} from "@frontend/features/model-selection/use-model-selection";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipTarget } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import {
  AppDropdownMenu,
  AppDropdownMenuContent,
  AppDropdownMenuTrigger,
} from "@frontend/widgets/app-dropdown-menu";

import { AgentFunctionModelsDialog } from "./agent-function-models-dialog";

/** 输入底栏的模型选择、上下文用量和思考等级共用一个配置控制器。 */
export function AgentComposerModelControls(props: {
  locked?: boolean;
  controller: ModelSelectionController;
  context_tokens: number | null;
  context_limits: ModelAgentLimits | null;
  usage: AgentUsageSnapshot;
  on_agent_model_select: (change: ModelSelectionInput) => boolean;
}): JSX.Element {
  const { t } = useI18n();
  // 菜单 Portal 位于输入区之外，随底部交互锁关闭并释放菜单状态。
  const [model_menu_open, set_model_menu_open] = useState(false);
  if (props.locked && model_menu_open) set_model_menu_open(false);
  const [functions_open, set_functions_open] = useState(false);
  const model_controls_disabled =
    props.locked === true || props.controller.loading || props.controller.updating;
  const selected_model = read_selected_model(props.controller, "agent");
  const selected_model_name =
    selected_model?.name || selected_model?.id || t("app.model.selection.unavailable");
  const selected_thinking_label =
    selected_model === null
      ? null
      : t(MODEL_THINKING_LEVEL_LABEL_KEY[selected_model.thinking_level]);
  const model_selection_label = t("app.model.selection.label");
  const model_selection_aria_label = `${model_selection_label}: ${selected_model_name}${selected_thinking_label === null ? "" : ` · ${selected_thinking_label}`}`;
  // 已有会话使用实际容量，选择变化只影响下一次模型操作。
  const limits = props.context_limits ?? selected_model?.agent_limits;
  const context_usage =
    limits === undefined
      ? null
      : format_context_usage({
          tokens: props.context_tokens,
          contextWindow: limits.context_window,
          maxTokens: limits.max_output_tokens,
        });

  const function_rows = [
    ["agent", t("agent_page.function_models.agent")],
    ["agent_batch_translation", t("agent_page.function_models.translation")],
    ["agent_media", t("agent_page.function_models.media")],
  ] as const;
  return (
    <>
      <ModelMenuButton
        open={model_menu_open}
        on_open_change={set_model_menu_open}
        disabled={model_controls_disabled}
        label={
          context_usage === null
            ? model_selection_aria_label
            : `${model_selection_aria_label} · ${context_usage.percent}`
        }
        icon={<Bot aria-hidden="true" />}
        name={selected_model_name}
        thinking_label={selected_thinking_label}
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
          <div className="grid grid-cols-[auto_auto] gap-x-8 gap-y-0.5 tabular-nums">
            <span>{t("agent_page.usage.input")}</span>
            <span className="text-right">
              {format_usage_tokens(
                props.usage.input + props.usage.cacheRead + props.usage.cacheWrite,
              )}
            </span>
            <span>{t("agent_page.usage.output")}</span>
            <span className="text-right">{format_usage_tokens(props.usage.output)}</span>
            <span>{t("agent_page.usage.cache_hit_rate")}</span>
            <span className="text-right">{format_cache_hit_rate(props.usage)}</span>
            <span>
              {t(
                context_usage?.warning
                  ? "agent_page.context_usage_warning"
                  : "agent_page.usage.context_window",
              )}
            </span>
            <span className="text-right">
              {context_usage === null ? "0K/0K" : `${context_usage.used}/${context_usage.total}`}
            </span>
          </div>
        }
      >
        <ModelSelectionOptions
          models={props.controller.snapshot.models}
          value={props.controller.snapshot.model_selection.agent}
          on_select={props.on_agent_model_select}
          disabled={model_controls_disabled}
        />
      </ModelMenuButton>
      <Tooltip disabled={functions_open}>
        <TooltipTrigger
          render={
            <TooltipTarget>
              <AppButton
                type="button"
                size="sm"
                variant="ghost"
                className="agent-composer__model-trigger"
                disabled={model_controls_disabled}
                onClick={() => set_functions_open(true)}
              >
                <Network aria-hidden="true" />
                {t("agent_page.function_models.title")}
              </AppButton>
            </TooltipTarget>
          }
        />
        <TooltipContent>
          <div className="agent-function-models__tooltip">
            {function_rows.map(([usage, label]) => {
              const id = props.controller.snapshot.model_selection[usage];
              const model = props.controller.snapshot.models.find((item) => item.id === id);
              const name =
                id === null
                  ? t("agent_page.function_models.follow")
                  : model?.name || model?.id || t("app.model.selection.unavailable");
              return (
                <Fragment key={usage}>
                  <span>{label}</span>
                  <span>{name}</span>
                </Fragment>
              );
            })}
          </div>
        </TooltipContent>
      </Tooltip>
      <AgentFunctionModelsDialog
        open={functions_open}
        on_close={() => set_functions_open(false)}
        locked={props.locked === true}
        controller={props.controller}
        on_agent_model_select={props.on_agent_model_select}
      />
    </>
  );
}

/** 主控快捷入口组合模型菜单、等级与会话统计提示。 */
function ModelMenuButton(props: {
  open: boolean;
  on_open_change: (open: boolean) => void;
  disabled: boolean;
  label: string;
  icon: ReactNode;
  name: string;
  thinking_label: string | null;
  detail?: ReactNode;
  tooltip: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <AppDropdownMenu open={props.open} onOpenChange={props.on_open_change}>
      <Tooltip disabled={props.open}>
        <TooltipTrigger
          render={
            <TooltipTarget>
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
                    {props.thinking_label === null ? null : (
                      <>
                        <span
                          className="agent-composer__model-context-separator"
                          aria-hidden="true"
                        >
                          ·
                        </span>
                        <span className="agent-composer__model-thinking">
                          {props.thinking_label}
                        </span>
                      </>
                    )}
                    {props.detail}
                    <ChevronDown aria-hidden="true" />
                  </AppButton>
                }
              />
            </TooltipTarget>
          }
        />
        <TooltipContent className="flex-col items-start gap-0.5">{props.tooltip}</TooltipContent>
      </Tooltip>
      <AppDropdownMenuContent align="start" matchTriggerWidth={false}>
        {props.children}
      </AppDropdownMenuContent>
    </AppDropdownMenu>
  );
}

/** 一次生成上下文百分比、详情与色阶，避免组件分别重复派生。 */
function format_context_usage(usage: {
  tokens: number | null;
  contextWindow: number;
  maxTokens: number;
}): {
  percent: string;
  used: string;
  total: string;
  tone: "default" | "warning";
  warning: boolean;
} {
  const percent = ((usage.tokens ?? 0) / usage.contextWindow) * 100;
  // 预警到自动压缩之间保留一份最大输出预算。
  const warning =
    usage.tokens !== null &&
    usage.tokens >= usage.contextWindow - usage.maxTokens - AGENT_COMPACTION_RESERVE_TOKENS;
  return {
    percent: `${percent.toFixed(1)}%`,
    used: format_context_tokens(usage.tokens ?? 0),
    total: format_context_tokens(usage.contextWindow),
    tone: warning ? "warning" : "default",
    warning,
  };
}

/** 鼠标提示中的上下文详情固定以整数 K 展示。 */
function format_context_tokens(tokens: number): string {
  return `${Math.round(tokens / 1_000).toString()}K`;
}

/** 累计输入输出按数量选择 K 或 M，保留两位小数并省略整值的小数部分。 */
function format_usage_tokens(tokens: number): string {
  if (tokens < 1_000) return tokens.toString();
  const unit = tokens < 1_000_000 ? 1_000 : 1_000_000;
  return `${(tokens / unit).toFixed(2).replace(/\.00$/, "")}${unit === 1_000 ? "K" : "M"}`;
}

/** 缓存读取占全部输入的比例，缓存写入也计入分母。 */
function format_cache_hit_rate(usage: AgentUsageSnapshot): string {
  const input = usage.input + usage.cacheRead + usage.cacheWrite;
  return `${(input === 0 ? 0 : (usage.cacheRead / input) * 100).toFixed(2)}%`;
}
