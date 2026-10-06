import { isDeepStrictEqual } from "node:util";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  CommitPublication,
  ConversationRecord,
  EntryRecord,
  LiveState,
  SubmissionRecord,
  TaskRecord,
  UsageState,
} from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import type { AgentEntry, AgentUsageSnapshot } from "../../shared/agent";
import { JsonTool } from "../../shared/utils/json-tool";
import { project_assistant_message_parts } from "./agent-message";
import type { AgentInputRecord, AgentChatData } from "./agent-chat-data";

/** 流式与正式响应使用同一任务身份，人工修订使用条目身份。 */
export const assistant_entry_id = (task: number | undefined, entry: number): string =>
  `assistant:${task ?? `entry:${entry}`}`;
const UNCOMMITTED_ENTRY_ORDER = Number.MAX_SAFE_INTEGER; // 尚无 SDK 条目身份的正文暂居轮次末尾

type TaskRecordValue = TaskRecord<JsonValue, JsonValue, JsonValue>;
type Row = { order: number; entry: AgentEntry };
export type AgentTimelineChange = { replace: boolean; entries: AgentEntry[] };

/** 可重建的公开投影。原始事实和查询索引只在这里保存，正文更新不扫描历史。 */
export class AgentChatView {
  public readonly records = new Map<number, EntryRecord>(); // 已读取的 SDK 历史，供分支恢复与修订定位
  public readonly conversations = new Map<number, ConversationRecord>(); // 分支继承关系，用于计算祖先切点
  public readonly submissions = new Map<number, SubmissionRecord>(); // 产品输入与实际历史条目的关联回执
  public readonly compactions = new Map<number, TaskRecordValue>(); // 公开压缩条目的任务事实
  public readonly live = new Map<number, LiveState>(); // 按分支保存的已提交生成进度
  public readonly pendingUsages = new Map<number, UsageState>(); // 结算后释放的用量回执
  public usage: AgentUsageSnapshot = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  private conversationId: number | undefined;
  private state!: Readonly<AgentChatData>; // 本次投影采用的已提交产品状态
  private readonly bounds = new Map<number, number>(); // 各祖先分支可见条目的最大身份
  private readonly rows = new Map<string, Row>();
  private readonly inputs = new Map<number, AgentInputRecord>(); // 历史条目到产品输入的查询索引
  private readonly calls = new Map<string, string>(); // 工具调用身份到公开条目的查询索引
  private readonly userRecords = new Map<string, EntryRecord>(); // 轮次状态变化时定位原用户消息
  private readonly changed = new Map<string, AgentEntry>(); // 尚未发布的条目，同一身份只保留最新值
  private readonly pendingRecords = new Set<number>();
  private readonly pendingTasks = new Set<number>();
  private readonly pendingSubmissions = new Set<number>();
  private readonly totals = new Map<number, AgentUsageSnapshot>(); // 各分支已计入的用量，历史修订继续保留累计消耗
  private order: string[] = [];
  private currentRound: string | undefined; // 按历史顺序推进的当前产品轮次
  private liveId: string | undefined; // 当前流式正文身份，用于处理正文撤回
  private replace = true; // 下一次发布需要整体替换时间线
  private restoring = false; // 恢复期间先收集条目，结束后统一排序
  private liveChanged = false;

  /** 仅快照、修订和停止等低频读者需要物化完整数组。 */
  public get entries(): AgentEntry[] {
    return this.order.map((id) => this.rows.get(id)!.entry);
  }
  /** 祖先分支只公开切点以前的事实。 */
  private visible(conversation: number, id: number): boolean {
    return id <= (this.bounds.get(conversation) ?? -1);
  }
  /** 按 SDK 身份排序完整可见历史，供恢复和修订定位。 */
  public branch_records(): EntryRecord[] {
    return [...this.records.values()]
      .filter((record) => this.visible(record.conversationId, record.id))
      .sort((a, b) => a.id - b.id);
  }

  /** 同步提交监听器只记录失效范围，后续刷新在提交线外运行。 */
  public observe(publication: CommitPublication): void {
    for (const change of publication.changes) {
      if (change.type === "entry") {
        this.records.set(change.value.id, change.value);
        this.pendingRecords.add(change.value.id);
      } else if (change.type === "conversation")
        this.conversations.set(change.value.id, change.value);
      else if (change.type === "submission") {
        this.submissions.set(change.value.id, change.value);
        this.pendingSubmissions.add(change.value.id);
      } else if (change.type === "task" && change.value.kind === "pi.compaction") {
        this.compactions.set(change.value.id, change.value);
        this.pendingTasks.add(change.value.id);
      } else if (
        change.type === "document" &&
        change.value !== null &&
        change.conversationId !== undefined
      ) {
        if (change.record.kind === "pi.live") {
          this.live.set(change.conversationId, change.value as LiveState);
          if (change.conversationId === this.conversationId) this.liveChanged = true;
        }
        if (change.record.kind === "pi.usage") {
          this.pendingUsages.set(change.conversationId, change.value as UsageState);
        }
      }
    }
  }

  /** 结算已捕获提交，分支切换时重建索引，其余情况更新受影响条目。 */
  public refresh(conversationId: number, state: Readonly<AgentChatData>): void {
    if (conversationId !== this.conversationId) {
      this.conversationId = conversationId;
      this.bounds.clear();
      let record = this.conversations.get(conversationId);
      let ceiling = Number.MAX_SAFE_INTEGER;
      this.bounds.set(conversationId, ceiling);
      while (record?.parent !== undefined) {
        ceiling = Math.min(ceiling, record.parent.at);
        this.bounds.set(record.parent.conversationId, ceiling);
        record = this.conversations.get(record.parent.conversationId);
      }
      this.reset(
        this.branch_records(),
        this.submissions,
        [...this.compactions.values()].filter((task) => this.visible(task.conversationId, task.id)),
        this.live.get(conversationId) ?? {},
        state,
      );
    } else {
      const previous = this.state;
      this.state = state;
      for (const id of this.pendingSubmissions) {
        const submission = this.submissions.get(id)!;
        if (
          submission.type !== "input" ||
          submission.entry === undefined ||
          submission.requestId === undefined
        )
          continue;
        const input = state.inputs[submission.requestId];
        if (input !== undefined) this.inputs.set(submission.entry, input);
      }
      for (const id of [...this.pendingRecords].sort((a, b) => a - b)) {
        const record = this.records.get(id)!;
        if (this.visible(record.conversationId, id)) this.read_record(record);
      }
      if (previous.rounds !== state.rounds) {
        for (const [id, round] of Object.entries(state.rounds)) {
          if (round === previous.rounds[id]) continue;
          const record = this.userRecords.get(id);
          if (record !== undefined) this.read_user(record, this.inputs.get(record.id)!);
        }
      }
      // 时间元数据独立提交时也更新对应条目，覆盖刷新期间新任务到达的情况。
      if (previous.compactionStartedAt !== state.compactionStartedAt) {
        for (const [id, startedAt] of Object.entries(state.compactionStartedAt)) {
          if (startedAt !== previous.compactionStartedAt[id]) this.pendingTasks.add(Number(id));
        }
      }
      for (const id of this.pendingTasks) {
        const task = this.compactions.get(id)!;
        if (this.visible(task.conversationId, id)) this.read_task(task);
      }
      if (this.liveChanged || previous.rounds !== state.rounds)
        this.read_live(this.live.get(conversationId) ?? {});
    }
    for (const [id, state] of this.pendingUsages) {
      const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      for (const usage of Object.values(state.models)) {
        for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const)
          total[key] += usage[key];
      }
      const previous = this.totals.get(id);
      this.usage = { ...this.usage };
      for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const)
        this.usage[key] += total[key] - (previous?.[key] ?? 0);
      this.totals.set(id, total);
    }
    this.pendingRecords.clear();
    this.pendingSubmissions.clear();
    this.pendingTasks.clear();
    this.pendingUsages.clear();
    this.liveChanged = false;
  }

  /** 恢复和增量共用条目转换。分支替换只在这里清空公开索引。 */
  public reset(
    records: readonly EntryRecord[],
    submissions: ReadonlyMap<number, SubmissionRecord>,
    tasks: readonly TaskRecordValue[],
    live: Readonly<LiveState>,
    state: Readonly<AgentChatData>,
  ): void {
    this.state = state;
    this.rows.clear();
    this.inputs.clear();
    this.calls.clear();
    this.userRecords.clear();
    this.changed.clear();
    this.order = [];
    this.currentRound = undefined;
    this.liveId = undefined;
    this.replace = true;
    for (const submission of submissions.values()) {
      if (
        submission.type !== "input" ||
        submission.entry === undefined ||
        submission.requestId === undefined
      )
        continue;
      const input = state.inputs[submission.requestId];
      if (input !== undefined) this.inputs.set(submission.entry, input);
    }
    // 恢复时统一排序一次，避免每个历史压缩条目都触发插入和重排。
    this.restoring = true;
    try {
      for (const record of records) this.read_record(record);
      for (const task of tasks) this.read_task(task);
      this.read_live(live);
    } finally {
      this.restoring = false;
    }
    this.order = [...this.rows.keys()].sort(
      (a, b) => this.rows.get(a)!.order - this.rows.get(b)!.order,
    );
  }

  /** 发布者消费更新，不需要比较上一份完整快照。 */
  public take_change(): AgentTimelineChange {
    const result = { replace: this.replace, entries: [...this.changed.values()] };
    this.replace = false;
    this.changed.clear();
    return result;
  }

  /** 同一身份原位更新，删除或非尾部顺序变化要求发布完整快照。 */
  private put(entry: AgentEntry, order: number): void {
    const previous = this.rows.get(entry.id);
    if (previous?.order === order && isDeepStrictEqual(previous.entry, entry)) return;
    this.rows.set(entry.id, { entry, order });
    if (this.restoring) return;
    if (previous === undefined) {
      const last = this.order.at(-1);
      if (last === undefined || this.rows.get(last)!.order <= order) this.order.push(entry.id);
      else {
        this.order.push(entry.id);
        this.order.sort((a, b) => this.rows.get(a)!.order - this.rows.get(b)!.order);
        this.replace = true;
      }
    } else if (previous.order !== order) {
      const index = this.order.indexOf(entry.id);
      const before = this.order[index - 1];
      const after = this.order[index + 1];
      if (
        (before !== undefined && this.rows.get(before)!.order > order) ||
        (after !== undefined && this.rows.get(after)!.order < order)
      ) {
        this.order.sort((a, b) => this.rows.get(a)!.order - this.rows.get(b)!.order);
        this.replace = true;
      }
    }
    this.changed.set(entry.id, entry);
  }

  /** 移除已撤回的临时正文，并让前端重新取得完整顺序。 */
  private remove(id: string): void {
    if (!this.rows.delete(id)) return;
    this.changed.delete(id);
    this.order = this.order.filter((candidate) => candidate !== id);
    this.replace = true;
  }

  /** `hidden` 输入留在模型历史，普通输入与 `steer` 按产品身份展示。 */
  private read_user(record: EntryRecord, input: AgentInputRecord): void {
    if (input.delivery === "hidden") return;
    const createdAt = record.model?.find((message) => message.role === "user")?.timestamp ?? 0;
    const base = {
      kind: "user_message" as const,
      id: input.delivery === "round" ? input.roundId : `user:${record.id}`,
      text: input.message.text,
      attachments: structuredClone(input.message.attachments),
      createdAt,
    };
    const round = this.state.rounds[input.roundId];
    this.put(
      input.delivery === "steer"
        ? { ...base, delivery: "steer", status: "success", endedAt: createdAt }
        : {
            ...base,
            delivery: "round",
            status: round?.status ?? "running",
            endedAt: round?.endedAt ?? null,
            averageTokensPerSecond: round?.averageTokensPerSecond ?? null,
          },
      record.id,
    );
    if (input.delivery === "round") this.userRecords.set(input.roundId, record);
  }

  /** 按历史顺序转换消息，工具结果归回原调用及其所属轮次。 */
  private read_record(record: EntryRecord): void {
    const input = this.inputs.get(record.id);
    if (input !== undefined && input.delivery !== "hidden") {
      this.currentRound = input.roundId;
      this.read_user(record, input);
    }
    if (this.currentRound === undefined) return;
    for (const message of record.model ?? []) {
      if (message.role === "assistant") {
        const id = assistant_entry_id(record.byTaskId, record.id);
        const parts = project_assistant_message_parts(message);
        if (parts !== null) {
          this.put(
            {
              kind: "assistant_message",
              id,
              parts,
              status:
                message.stopReason === "error"
                  ? "error"
                  : message.stopReason === "aborted"
                    ? "stopped"
                    : "success",
              createdAt: message.timestamp,
            },
            record.id,
          );
        }
        if (parts === null) this.remove(id);
        for (const call of message.content) {
          if (call.type !== "toolCall") continue;
          const id = `tool:${record.id}:${call.id}`;
          this.calls.set(call.id, id);
          this.put(
            {
              kind: "tool_call",
              id,
              toolName: call.name,
              input: JsonTool.stringifyStrict(call.arguments),
              status: "running",
              output: null,
              createdAt: message.timestamp,
            },
            record.id,
          );
        }
      } else if (message.role === "toolResult") {
        const id = this.calls.get(message.toolCallId);
        const row = id === undefined ? undefined : this.rows.get(id);
        if (row?.entry.kind !== "tool_call") continue;
        this.put(
          {
            ...row.entry,
            status: has_aborted_diagnostic(record)
              ? "stopped"
              : message.isError
                ? "error"
                : "success",
            output: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
          },
          row.order,
        );
      }
    }
  }

  /** 压缩任务的终态直接决定对应诊断条目。 */
  private read_task(task: TaskRecordValue): void {
    this.put(
      {
        kind: "context_compaction",
        id: `compaction:${task.id}`,
        createdAt: this.state.compactionStartedAt[task.id] ?? null,
        status:
          task.state.status === "terminal"
            ? task.state.outcome.status === "completed"
              ? "success"
              : task.state.outcome.status === "aborted"
                ? "stopped"
                : "error"
            : "running",
      },
      task.id,
    );
  }

  /** 流式正文沿用任务身份，正式条目以 SDK 排序身份接替临时位置。 */
  private read_live(live: Readonly<LiveState>): void {
    const message = live.generation?.message as AssistantMessage | undefined;
    const parts = message === undefined ? null : project_assistant_message_parts(message);
    const nextId =
      live.run === undefined || parts === null ? undefined : assistant_entry_id(live.run.taskId, 0);
    if (
      this.liveId !== undefined &&
      this.liveId !== nextId &&
      this.rows.get(this.liveId)?.order === UNCOMMITTED_ENTRY_ORDER
    ) {
      this.remove(this.liveId);
    }
    this.liveId = nextId;
    if (
      nextId === undefined ||
      message === undefined ||
      parts === null ||
      this.currentRound === undefined
    )
      return;
    this.put(
      {
        kind: "assistant_message",
        id: nextId,
        parts,
        status: "running",
        createdAt: message.timestamp,
      },
      UNCOMMITTED_ENTRY_ORDER,
    );
  }
}

/** SDK 的稳定诊断码区分用户取消与执行失败，保留模型实际收到的工具回执。 */
function has_aborted_diagnostic(record: EntryRecord): boolean {
  const data = record.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const diagnostics = data["diagnostics"];
  return (
    Array.isArray(diagnostics) &&
    diagnostics.some(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        value["code"] === "aborted",
    )
  );
}
