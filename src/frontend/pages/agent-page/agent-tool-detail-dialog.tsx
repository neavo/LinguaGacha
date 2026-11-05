import { type JSX, memo, useMemo, useState } from "react";

import type { AgentToolEntry } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useAgentRunOutput } from "@frontend/app/session/agent/agent-chat-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@frontend/shadcn/tabs";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import {
  AGENT_STATUS_LABEL_KEYS,
  useAgentElapsed,
} from "@frontend/pages/agent-page/agent-entry-status";
import { AgentStatusMark } from "@frontend/pages/agent-page/agent-status-mark";
import { format_agent_tool_payload } from "./agent-tool-payload";
import { format_agent_tool_label } from "./agent-tool-label";

// 只声明代码字段，工具新增其他参数时仍完整显示载荷。
const AGENT_TOOL_CODE_INPUT_KEYS: Readonly<Record<string, string>> = { workspace_run: "script" };

type AgentToolPayloadChannel = "input" | "output";
type AgentToolPayloadOptions = {
  tool_name: string;
  fallback?: string;
} & (
  | { channel: "input"; content: string }
  | { channel: "output"; content: readonly string[] | null }
);
type AgentToolPayloadDocument = ReturnType<typeof format_agent_tool_payload>;

type AgentToolDetailDialogProps = {
  entry: AgentToolEntry;
  on_close: () => void;
};

/** 工具详情只挂载当前输入或输出面板，避免长载荷进入会话信息流 DOM。 */
export function AgentToolDetailDialog(props: AgentToolDetailDialogProps): JSX.Element {
  const { t } = useI18n();
  const entry = props.entry;
  const label = format_agent_tool_label(entry.toolName, entry.input);
  const [initial_channel] = useState<AgentToolPayloadChannel>(
    entry.output === null ? "input" : "output",
  );
  // 缓存只属于本次弹窗，两个标签各保留一份结果，关闭即释放；隐藏标签不提前解析。
  const [read_payload] = useState(() => {
    const cache = new Map<
      AgentToolPayloadChannel,
      { options: AgentToolPayloadOptions; document: AgentToolPayloadDocument }
    >();
    /** 标签卸载后仍复用文档，空输出的状态文案也参与失效判断。 */
    return (options: AgentToolPayloadOptions): AgentToolPayloadDocument => {
      const previous = cache.get(options.channel);
      if (
        previous?.options.content === options.content &&
        previous.options.tool_name === options.tool_name &&
        previous.options.fallback === options.fallback
      )
        return previous.document;
      const document = resolve_agent_tool_payload(options);
      cache.set(options.channel, { options, document });
      return document;
    };
  });
  const run_output = useAgentRunOutput(entry.id);
  // 引用随输出变化才更新，`read_payload` 的缓存据此命中。
  const live = useMemo(
    () =>
      run_output === null
        ? null
        : [JSON.stringify({ stdout: run_output.stdout, stderr: run_output.stderr })],
    [run_output],
  );
  const active = entry.status === "running";
  const duration = useAgentElapsed(entry.createdAt, active);
  const status_label = t(AGENT_STATUS_LABEL_KEYS[entry.status]);
  const title = t("agent_page.tool.details", { tool: label });
  return (
    <AppPageDialog
      open
      size="viewport"
      title={title}
      onClose={props.on_close}
      bodyClassName="overflow-hidden p-0"
    >
      <div className="agent-tool-detail__header">
        <div className="agent-tool-detail__identity">
          <h2>{label}</h2>
          <span>
            {status_label}
            {active ? ` · ${duration}` : ""}
          </span>
        </div>
        <AgentStatusMark status={entry.status} label={status_label} />
      </div>

      <Tabs defaultValue={initial_channel} className="agent-tool-detail__tabs">
        <div className="agent-tool-detail__toolbar">
          <TabsList aria-label={title}>
            <TabsTrigger value="input">{t("agent_page.tool.input")}</TabsTrigger>
            <TabsTrigger value="output">{t("agent_page.tool.output")}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="input" className="agent-tool-detail__panel">
          <AgentToolPayload
            read_payload={read_payload}
            tool_name={entry.toolName}
            channel="input"
            content={entry.input}
            aria_label={t("agent_page.tool.input")}
          />
        </TabsContent>
        <TabsContent value="output" className="agent-tool-detail__panel">
          <AgentToolPayload
            read_payload={read_payload}
            tool_name={entry.toolName}
            channel="output"
            content={entry.output ?? live}
            fallback={status_label}
            aria_label={t("agent_page.tool.output")}
          />
        </TabsContent>
      </Tabs>
    </AppPageDialog>
  );
}

/** 当前标签页复用只读编辑器展示大载荷，不复制编辑与校验能力。 */
const AgentToolPayload = memo(function AgentToolPayload(
  props: AgentToolPayloadOptions & {
    read_payload: (options: AgentToolPayloadOptions) => AgentToolPayloadDocument;
    aria_label: string;
  },
): JSX.Element {
  const payload = props.read_payload(props);
  return (
    <AppEditor
      variant="viewer"
      value={payload.text}
      ranges={payload.ranges}
      aria_label={props.aria_label}
      class_name="agent-tool-detail__viewer"
    />
  );
});

/** 输入与输出共用格式化规则，只有声明的输入字段叠加代码高亮。 */
function resolve_agent_tool_payload(options: AgentToolPayloadOptions): AgentToolPayloadDocument {
  if (options.content === null) {
    return { text: options.fallback ?? "", ranges: [] };
  }
  return options.channel === "input"
    ? format_agent_tool_payload([options.content], AGENT_TOOL_CODE_INPUT_KEYS[options.tool_name])
    : format_agent_tool_payload(options.content);
}
