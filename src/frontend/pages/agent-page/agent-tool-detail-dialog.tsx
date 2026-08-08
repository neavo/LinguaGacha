import { useMemo, useState } from "react";
import { WrapText } from "lucide-react";

import type { AgentToolEntry } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@frontend/shadcn/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/shadcn/tooltip";
import { AppButton } from "@frontend/widgets/app-button";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { AGENT_STATUS_LABEL_KEYS, AgentStatusMark, useAgentElapsed } from "./agent-entry-status";

type AgentToolDetailDialogProps = {
  entry: AgentToolEntry;
  on_close: () => void;
};

/** 工具详情只挂载当前输入或输出面板，避免长载荷进入会话信息流 DOM。 */
export function AgentToolDetailDialog(props: AgentToolDetailDialogProps): JSX.Element {
  const { t } = useI18n();
  const [wrap_lines, set_wrap_lines] = useState(false);
  const entry = props.entry;
  const active = entry.status === "running";
  const duration = useAgentElapsed(entry.createdAt, active);
  const status_label = t(AGENT_STATUS_LABEL_KEYS[entry.status]);
  const title = t("agent_page.tool.details", { tool: entry.toolName });
  const wrap_label = t(
    wrap_lines ? "agent_page.tool.wrap_enabled" : "agent_page.tool.wrap_disabled",
  );

  return (
    <AppPageDialog
      open
      size="xl"
      title={title}
      onClose={props.on_close}
      bodyClassName="overflow-hidden p-0"
    >
      <div className="agent-tool-detail__header">
        <div className="agent-tool-detail__identity">
          <h2>{entry.toolName}</h2>
          <span>
            {status_label}
            {active ? ` · ${duration}` : ""}
          </span>
        </div>
        <AgentStatusMark status={entry.status} label={status_label} />
      </div>

      <Tabs
        defaultValue={entry.output === null ? "input" : "output"}
        className="agent-tool-detail__tabs"
      >
        <div className="agent-tool-detail__toolbar">
          <TabsList aria-label={title}>
            <TabsTrigger value="input">{t("agent_page.tool.input")}</TabsTrigger>
            <TabsTrigger value="output">{t("agent_page.tool.output")}</TabsTrigger>
          </TabsList>
          <Tooltip>
            <TooltipTrigger asChild>
              <AppButton
                type="button"
                variant="ghost"
                size="icon-sm"
                className="agent-tool-detail__wrap-action"
                aria-label={wrap_label}
                aria-pressed={wrap_lines}
                onClick={() => set_wrap_lines((previous_value) => !previous_value)}
              >
                <WrapText aria-hidden="true" />
              </AppButton>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              <p>{wrap_label}</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <TabsContent value="input" className="agent-tool-detail__panel">
          <AgentToolPayload
            content={entry.input}
            aria_label={t("agent_page.tool.input")}
            wrap_lines={wrap_lines}
          />
        </TabsContent>
        <TabsContent value="output" className="agent-tool-detail__panel">
          <AgentToolPayload
            content={entry.output}
            fallback={status_label}
            aria_label={t("agent_page.tool.output")}
            wrap_lines={wrap_lines}
          />
        </TabsContent>
      </Tabs>
    </AppPageDialog>
  );
}

/** 当前标签页复用只读编辑器展示大载荷，不复制编辑与校验能力。 */
function AgentToolPayload(props: {
  content: string | null;
  fallback?: string;
  aria_label: string;
  wrap_lines: boolean;
}): JSX.Element {
  const payload = useMemo(
    () => resolve_tool_payload(props.content, props.fallback),
    [props.content, props.fallback],
  );
  return (
    <AppEditor
      variant="viewer"
      value={payload.text}
      syntax={payload.syntax}
      aria_label={props.aria_label}
      wrap_lines={props.wrap_lines}
      class_name="agent-tool-detail__viewer"
    />
  );
}

/** JSON 载荷便于人工检查，非 JSON 正文保持模型实际收到的原文。 */
function resolve_tool_payload(
  payload: string | null,
  fallback?: string,
): { text: string; syntax: "json" | "plain" } {
  if (payload === null) {
    return { text: fallback ?? "", syntax: "plain" };
  }

  try {
    return {
      text: JSON.stringify(JSON.parse(payload) as unknown, null, 2) ?? payload,
      syntax: "json",
    };
  } catch {
    return { text: payload, syntax: "plain" };
  }
}
