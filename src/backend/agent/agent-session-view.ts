import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  EntryRecord,
  LiveState,
  SubmissionRecord,
  TaskRecord,
} from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import type { AgentEntry, AgentEntryStatus } from "../../shared/agent";
import { JsonTool } from "../../shared/utils/json-tool";
import { project_assistant_message_parts } from "./agent-message";
import type { AgentSessionState } from "./agent-session-state";

/** SDK 任务补上产品记录的绝对时间，供重开后的压缩条目沿用。 */
export type AgentTaskFact = {
  record: TaskRecord<JsonValue, JsonValue, JsonValue>;
  createdAt: number;
};
/** 流式与已提交响应按生成任务共用身份，手工修订以条目身份区分。 */
export const assistant_entry_id = (task: number | undefined, entry: number): string =>
  `assistant:${task ?? `entry:${entry}`}`;

/** 完整分支历史与已提交进度共用一套公开转换，缓存只用于读取。 */
export function project_agent_session_entries(
  records: readonly EntryRecord[],
  submissions: ReadonlyMap<number, SubmissionRecord>,
  tasks: readonly AgentTaskFact[],
  live: Readonly<LiveState>,
  state: Readonly<AgentSessionState>,
): AgentEntry[] {
  const output: Array<{ order: number; entry: AgentEntry }> = [];
  const input_by_entry = new Map(
    [...submissions.values()].flatMap((record) =>
      record.type === "input" && record.entry !== undefined && record.requestId !== undefined
        ? [[record.entry, state.inputs[record.requestId]] as const]
        : [],
    ),
  );
  const calls = new Map<string, { item: { order: number; entry: AgentEntry }; round: string }>();
  let current_round: string | undefined;
  const status = (fallback: AgentEntryStatus): AgentEntryStatus =>
    current_round !== undefined && state.rounds[current_round]?.status === "stopped"
      ? "stopped"
      : fallback;
  for (const record of records) {
    const input = input_by_entry.get(record.id);
    if (input !== undefined && input.delivery !== "hidden") {
      current_round = input.roundId;
      const message = record.model?.find((message) => message.role === "user");
      const createdAt = message?.timestamp ?? 0;
      const base = {
        kind: "user_message" as const,
        id: input.delivery === "round" ? input.roundId : `user:${record.id}`,
        text: input.message.text,
        attachments: structuredClone(input.message.attachments),
        createdAt,
      };
      const round = state.rounds[input.roundId];
      output.push({
        order: record.id,
        entry:
          input.delivery === "steer"
            ? { ...base, delivery: "steer", status: "success", endedAt: createdAt }
            : {
                ...base,
                delivery: "round",
                status: round?.status ?? "running",
                endedAt: round?.endedAt ?? null,
                averageTokensPerSecond: round?.averageTokensPerSecond ?? null,
              },
      });
    }
    // 种子没有产品输入关联，因此不会制造公开 assistant 或工具条目。
    if (current_round === undefined) continue;
    for (const message of record.model ?? []) {
      if (message.role === "assistant") {
        const parts = project_assistant_message_parts(message);
        const frozenRound = state.rounds[current_round]?.status === "stopped";
        if (
          parts !== null &&
          (!frozenRound ||
            record.byTaskId === undefined || // 人工修订由用户提交，停止只冻结原执行的结果
            state.stoppedEntries[assistant_entry_id(record.byTaskId, record.id)] !== undefined)
        )
          output.push({
            order: record.id,
            entry: {
              kind: "assistant_message",
              id: assistant_entry_id(record.byTaskId, record.id),
              parts,
              status:
                message.stopReason === "error"
                  ? "error"
                  : message.stopReason === "aborted"
                    ? "stopped"
                    : "success",
              createdAt: message.timestamp,
            },
          });
        for (const call of message.content) {
          if (call.type !== "toolCall") continue;
          const stopped = status("running") === "stopped";
          if (stopped && state.stoppedEntries[`tool:${record.id}:${call.id}`] === undefined)
            continue;
          const item = {
            order: record.id,
            entry: {
              kind: "tool_call",
              id: `tool:${record.id}:${call.id}`,
              toolName: call.name,
              input: JsonTool.stringifyStrict(call.arguments),
              status: stopped ? "stopped" : "running",
              output: null,
              createdAt: message.timestamp,
            } as AgentEntry,
          };
          calls.set(call.id, { item, round: current_round });
          output.push(item);
        }
      } else if (message.role === "toolResult") {
        const found = calls.get(message.toolCallId);
        if (found === undefined || found.item.entry.kind !== "tool_call") continue;
        if (state.rounds[found.round]?.status === "stopped") continue;
        found.item.entry = {
          ...found.item.entry,
          status: message.isError ? "error" : "success",
          output: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
        };
      }
    }
  }
  const partial = live.generation?.message as AssistantMessage | undefined;
  if (partial !== undefined && live.run !== undefined && current_round !== undefined) {
    const parts = project_assistant_message_parts(partial);
    if (parts !== null)
      output.push({
        order: Number.MAX_SAFE_INTEGER,
        entry: {
          kind: "assistant_message",
          id: assistant_entry_id(live.run.taskId, 0),
          parts,
          status: status("running"),
          createdAt: partial.timestamp,
        },
      });
  }
  for (const { record, createdAt } of tasks) {
    if (record.kind !== "pi.compaction") continue;
    const state = record.state;
    output.push({
      order: record.id,
      entry: {
        kind: "context_compaction",
        id: `compaction:${record.id}`,
        createdAt,
        status:
          state.status === "terminal"
            ? state.outcome.status === "completed"
              ? "success"
              : "error"
            : "running",
      },
    });
  }
  const projected = output
    .sort((a, b) => a.order - b.order)
    .map(({ entry }) => state.stoppedEntries[entry.id]?.entry ?? entry);
  // 停止时冲刷的最后正文可能尚未进入 SDK 节流提交，只在所属轮次仍可见时补回。
  for (const { entry, roundId } of Object.values(state.stoppedEntries)) {
    if (projected.some((candidate) => candidate.id === entry.id)) continue;
    if (entry.kind !== "assistant_message") continue;
    const index = projected.findIndex((candidate) => candidate.id === roundId);
    if (index < 0) continue;
    const nextRound = projected.findIndex(
      (candidate, position) =>
        position > index && candidate.kind === "user_message" && candidate.delivery === "round",
    );
    projected.splice(nextRound < 0 ? projected.length : nextRound, 0, entry);
  }
  return projected;
}
