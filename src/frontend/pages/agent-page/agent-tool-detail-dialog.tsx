import { useMemo, useRef } from "react";

import { is_json_record } from "@domain/json";
import type { AgentToolEntry } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@frontend/shadcn/tabs";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import type { AppEditorSyntax } from "@frontend/widgets/app-editor/app-editor-code-mirror";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { AGENT_STATUS_LABEL_KEYS, AgentStatusMark, useAgentElapsed } from "./agent-entry-status";

type AgentToolPayloadChannel = "input" | "output";

type AgentToolDetailDialogProps = {
  entry: AgentToolEntry;
  on_close: () => void;
};

/** 工具详情只挂载当前输入或输出面板，避免长载荷进入会话信息流 DOM。 */
export function AgentToolDetailDialog(props: AgentToolDetailDialogProps): JSX.Element {
  const { t } = useI18n();
  const entry = props.entry;
  const initial_tab_ref = useRef<"input" | "output">(entry.output === null ? "input" : "output");
  const active = entry.status === "running";
  const duration = useAgentElapsed(entry.createdAt, active);
  const status_label = t(AGENT_STATUS_LABEL_KEYS[entry.status]);
  const title = t("agent_page.tool.details", { tool: entry.toolName });
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

      <Tabs defaultValue={initial_tab_ref.current} className="agent-tool-detail__tabs">
        <div className="agent-tool-detail__toolbar">
          <TabsList aria-label={title}>
            <TabsTrigger value="input">{t("agent_page.tool.input")}</TabsTrigger>
            <TabsTrigger value="output">{t("agent_page.tool.output")}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="input" className="agent-tool-detail__panel">
          <AgentToolPayload
            tool_name={entry.toolName}
            channel="input"
            content={entry.input}
            aria_label={t("agent_page.tool.input")}
          />
        </TabsContent>
        <TabsContent value="output" className="agent-tool-detail__panel">
          <AgentToolPayload
            tool_name={entry.toolName}
            channel="output"
            content={entry.output}
            fallback={status_label}
            aria_label={t("agent_page.tool.output")}
          />
        </TabsContent>
      </Tabs>
    </AppPageDialog>
  );
}

/** 当前标签页复用只读编辑器展示大载荷，不复制编辑与校验能力。 */
function AgentToolPayload(props: {
  tool_name: string;
  channel: AgentToolPayloadChannel;
  content: string | null;
  fallback?: string;
  aria_label: string;
}): JSX.Element {
  const payload = useMemo(
    () =>
      resolve_agent_tool_payload({
        tool_name: props.tool_name,
        channel: props.channel,
        content: props.content,
        fallback: props.fallback,
      }),
    [props.channel, props.content, props.fallback, props.tool_name],
  );
  return (
    <AppEditor
      variant="viewer"
      value={payload.text}
      syntax={payload.syntax}
      aria_label={props.aria_label}
      class_name="agent-tool-detail__viewer"
    />
  );
}

/** JSON 载荷按语义格式化，工作区脚本输入直接展示实际执行的 TypeScript 正文。 */
function resolve_agent_tool_payload(options: {
  tool_name: string;
  channel: AgentToolPayloadChannel;
  content: string | null;
  fallback?: string;
}): { text: string; syntax: AppEditorSyntax } {
  if (options.content === null) {
    return { text: options.fallback ?? "", syntax: "plain" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(options.content) as unknown;
  } catch {
    return { text: options.content, syntax: "plain" };
  }

  if (options.channel === "input" && options.tool_name === "workspace_script") {
    const script = read_workspace_script(parsed);
    if (script !== null) {
      return { text: script, syntax: "typescript" };
    }
  }

  return {
    text: JSON.stringify(parsed, null, 2) ?? options.content,
    syntax: "json",
  };
}

/** 只在结构完整匹配当前工具契约时提取脚本，使显示内容覆盖调用的全部输入。 */
function read_workspace_script(value: unknown): string | null {
  if (!is_json_record(value) || Object.keys(value).length !== 1) {
    return null;
  }

  const script = value["script"];
  return typeof script === "string" && script.length > 0 ? script : null;
}
