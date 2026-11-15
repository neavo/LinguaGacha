import { type JSX, memo, useMemo, useState } from "react";
import { Image } from "lucide-react";

import type { AgentToolEntry } from "@shared/agent";
import { useI18n } from "@frontend/app/locale/locale-context";
import { useAgentChatId, useAgentRunOutput } from "@frontend/app/session/agent/agent-chat-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@frontend/shadcn/tabs";
import { AppEditor } from "@frontend/widgets/app-editor/app-editor";
import { AppPageDialog } from "@frontend/widgets/app-page-dialog";
import { AppContentState } from "@frontend/widgets/app-content-state";
import {
  AGENT_STATUS_LABEL_KEYS,
  useAgentElapsed,
} from "@frontend/pages/agent-page/agent-entry-status";
import { AgentStatusMark } from "@frontend/pages/agent-page/agent-status-mark";
import { AgentToolImage } from "./agent-tool-image";
import { format_agent_tool_payload } from "./agent-tool-payload";
import { format_agent_tool_label } from "./agent-tool-label";

// 只声明代码字段，工具新增其他参数时仍完整显示载荷。
const AGENT_TOOL_CODE_INPUT_KEYS: Readonly<Record<string, string>> = { workspace_run: "script" };

type AgentToolPayloadChannel = "input" | "output";
type AgentToolDetailTab = AgentToolPayloadChannel | number;
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

/** 工具详情按会话与条目身份持有标签选择，避免跨条目串扰或提前拉取资源。 */
export function AgentToolDetailDialog(props: AgentToolDetailDialogProps): JSX.Element {
  const chat_id = useAgentChatId();
  return (
    <AgentToolDetailDialogContent
      key={`${chat_id ?? ""}:${props.entry.id}`}
      {...props}
      chat_id={chat_id}
    />
  );
}

/** 当前条目的详查主体：同条目完成或重放时保留焦点标签，切换条目后自动复位。 */
function AgentToolDetailDialogContent(
  props: AgentToolDetailDialogProps & { chat_id: string | null },
): JSX.Element {
  const { t } = useI18n();
  const { entry, chat_id } = props;
  const label = format_agent_tool_label(entry.toolName, entry.input);
  const default_tab: AgentToolPayloadChannel = entry.output === null ? "input" : "output";
  const [selected_tab, set_selected_tab] = useState<AgentToolDetailTab>(default_tab);
  const active_tab: AgentToolDetailTab =
    typeof selected_tab === "number" && selected_tab >= entry.imageCount
      ? default_tab
      : selected_tab;
  const image_tabs = Array.from({ length: entry.imageCount }, (_, index) => ({
    index,
    label: `${t("agent_page.image.title")} ${index + 1}`,
  }));
  // 缓存只属于本次弹窗，两个文本标签各保留一份结果，关闭即释放；隐藏标签不提前解析。
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

      <Tabs
        value={active_tab}
        onValueChange={(value) => {
          if (value === "input" || value === "output" || typeof value === "number") {
            set_selected_tab(value);
          }
        }}
        className="agent-tool-detail__tabs"
      >
        <div className="agent-tool-detail__toolbar">
          <TabsList aria-label={title} className="agent-tool-detail__tab-list">
            <TabsTrigger value="input">{t("agent_page.tool.input")}</TabsTrigger>
            <TabsTrigger value="output">{t("agent_page.tool.output")}</TabsTrigger>
            {image_tabs.map(({ index, label }) => (
              <TabsTrigger key={index} value={index} aria-label={label}>
                <Image className="size-3.5" aria-hidden="true" />
              </TabsTrigger>
            ))}
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
        {/* 会话、条目和图片标签共同拥有挂载身份，单图组件无需重复维护身份状态。 */}
        {image_tabs.map(({ index, label }) => (
          <TabsContent
            key={index}
            value={index}
            className="agent-tool-detail__panel agent-tool-detail__panel--media"
          >
            {chat_id === null ? (
              <AppContentState status="error" />
            ) : (
              <AgentToolImage chat_id={chat_id} entry_id={entry.id} index={index} label={label} />
            )}
          </TabsContent>
        ))}
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
