import { isDeepStrictEqual } from "node:util";
import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
import {
  ToolTask,
  type CommitPublication,
  type ConversationRecord,
  type EntryId,
  type EntryRecord,
  type LiveState,
  type SubmissionRecord,
  type TaskRecord,
  type ToolTaskInput,
  type UsageState,
} from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord/json";
import type { AgentEntry, AgentToolEntry, AgentUsageSnapshot } from "../../shared/agent";
import { SUPPORTED_RASTER_IMAGE_MIMES } from "../../shared/image-formats";
import { JsonTool } from "../../shared/utils/json-tool";
import {
  project_assistant_message_parts,
  read_agent_tool_calls,
  read_agent_tool_result_status,
} from "./agent-message";
import { read_agent_input, type AgentInputRecord, type AgentChatData } from "./agent-chat-data";
import { read_agent_compaction_result } from "./agent-compaction";

/** 流式与正式响应使用同一任务身份，人工修订使用条目身份。 */
export const assistant_entry_id = (task: number | undefined, entry: number): string =>
  `assistant:${task ?? `entry:${entry}`}`;
const UNCOMMITTED_ENTRY_ORDER = Number.MAX_SAFE_INTEGER; // 尚无 SDK 条目身份的正文暂居轮次末尾

type TaskRecordValue = TaskRecord<JsonValue, JsonValue, JsonValue>;
type Row = { order: number; rank: number; entry: AgentEntry };
type ToolCallMeta = {
  recordId: EntryId;
  rank: number;
  entry: Pick<AgentToolEntry, "kind" | "id" | "toolName" | "input">;
};
type StartedToolTask = Readonly<{
  assistant: EntryId;
  callId: string;
  startedAt: number;
}>;
export type AgentTimelineChange = { replace: boolean; entries: AgentEntry[] };

const compare_row = (a: Row, b: Row): number => a.order - b.order || a.rank - b.rank;

/** 可重建的公开投影。原始事实和查询索引只在这里保存，正文更新不扫描历史。 */
export class AgentChatView {
  public readonly records = new Map<number, EntryRecord>(); // 已读取的 SDK 历史，供分支恢复与修订定位
  public readonly conversations = new Map<number, ConversationRecord>(); // 分支继承关系，用于计算祖先切点
  public readonly submissions = new Map<number, SubmissionRecord>(); // 产品输入与实际历史条目的关联回执
  public readonly compactions = new Map<number, TaskRecordValue>(); // 公开压缩条目的任务事实
  public live: Readonly<LiveState> = {}; // 活动分支的内存进度，落盘回执不覆盖它。
  public readonly pendingUsages = new Map<number, UsageState>(); // 结算后释放的用量回执
  public usage: AgentUsageSnapshot = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  private conversationId: number | undefined;
  private state!: Readonly<AgentChatData>; // 本次投影采用的已提交产品状态
  private readonly bounds = new Map<number, number>(); // 各祖先分支可见条目的最大身份
  private readonly rows = new Map<string, Row>();
  private readonly inputSubmissions = new Map<number, SubmissionRecord>(); // 旧历史通过条目身份定位原提交回执
  private readonly compactionSubmissions = new Map<number, number>(); // 写入回执身份到压缩任务身份。
  private readonly toolCalls = new Map<string, ToolCallMeta>(); // 只索引可见的助手记录，以原记录身份配对
  private readonly activeToolTasks = new Map<number, StartedToolTask>(); // 跨分支保留尚未结算的首次启动事实
  private readonly toolImages = new Map<string, readonly Readonly<ImageContent>[]>(); // 已提交工具回执的可见图片索引
  private readonly userRecords = new Map<string, EntryRecord>(); // 轮次状态变化时定位原用户消息
  private readonly changed = new Map<string, AgentEntry>(); // 尚未发布的条目，同一身份只保留最新值
  private readonly pendingRecords = new Set<number>();
  private readonly pendingCompactions = new Set<number>();
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
  /** 实例故障只覆盖当前公开轮次，重开投影仍由持久化回执决定。 */
  public fail_round(id: string | null, endedAt: number): void {
    const row = id === null ? undefined : this.rows.get(id);
    if (row?.entry.kind === "user_message" && row.entry.delivery === "round")
      this.put({ ...row.entry, status: "error", endedAt }, row.order);
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

  /** 索引已提交事实并交付本批首次工具启动，后续刷新在提交线外运行。 */
  public observe(publication: CommitPublication): StartedToolTask[] {
    const startedTools: StartedToolTask[] = [];
    for (const change of publication.changes) {
      if (change.type === "entry") {
        this.records.set(change.value.id, change.value);
        this.pendingRecords.add(change.value.id);
      } else if (change.type === "conversation")
        this.conversations.set(change.value.id, change.value);
      else if (change.type === "submission") {
        this.submissions.set(change.value.id, change.value);
        this.index_input_submission(change.value);
        const taskId = this.compactionSubmissions.get(change.value.id);
        if (taskId !== undefined) this.pendingCompactions.add(taskId);
      } else if (change.type === "task" && change.value.kind === "pi.compaction") {
        this.compactions.set(change.value.id, change.value);
        this.index_compaction_submission(change.value);
        this.pendingCompactions.add(change.value.id);
      } else if (change.type === "task" && change.value.kind === ToolTask.definition.name) {
        const { id, startedAt, state } = change.value;
        if (state.status === "terminal") {
          this.activeToolTasks.delete(id);
          continue;
        }
        if (startedAt === undefined || this.activeToolTasks.has(id)) continue;
        const input = change.value.input as ToolTaskInput; // 固定的 SDK 任务类型拥有输入契约。
        if (input.kind !== "model") continue;
        const task = { assistant: input.assistant, callId: input.callId, startedAt };
        this.activeToolTasks.set(id, task);
        startedTools.push(task);
      } else if (
        change.type === "document" &&
        change.kind === "change" &&
        change.conversationId !== undefined &&
        change.record.kind === "pi.usage"
      ) {
        this.pendingUsages.set(change.conversationId, change.value as UsageState);
      }
    }
    return startedTools;
  }

  /** 旧用户条目通过输入回执查找产品轮次。 */
  private index_input_submission(submission: SubmissionRecord): void {
    if (
      submission.type === "input" &&
      submission.entry !== undefined &&
      submission.requestId !== undefined
    )
      this.inputSubmissions.set(submission.entry, submission);
  }

  /** 摘要写入晚于任务完成时，按回执身份重投影压缩条目。 */
  private index_compaction_submission(task: TaskRecordValue): void {
    if (task.state.status !== "terminal" || task.state.outcome.status !== "completed") return;
    const result = task.state.outcome.result;
    if (
      typeof result === "object" &&
      result !== null &&
      !Array.isArray(result) &&
      typeof result["submissionId"] === "number"
    )
      this.compactionSubmissions.set(result["submissionId"], task.id);
  }

  /** 标记流式条目，下一次刷新与正式回执一起发布。 */
  public update_live(live: Readonly<LiveState>): void {
    this.live = live;
    this.liveChanged = true;
  }

  /** 首次投影和分支切换重建时间线，其余提交增量更新。 */
  public refresh(conversationId: number, state: Readonly<AgentChatData>, stopping = false): void {
    if (conversationId !== this.conversationId) {
      if (this.conversationId === undefined) {
        // 历史从存储初始化，后续提交直接在 observe 更新跨分支的回执索引。
        for (const submission of this.submissions.values()) this.index_input_submission(submission);
        for (const task of this.compactions.values()) this.index_compaction_submission(task);
      }
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
      this.reset(state);
    } else {
      const previous = this.state;
      this.state = state;
      for (const id of [...this.pendingRecords].sort((a, b) => a - b)) {
        const record = this.records.get(id)!;
        if (this.visible(record.conversationId, id)) this.read_record(record);
      }
      this.read_active_tools();
      if (previous.rounds !== state.rounds) {
        for (const [id, round] of Object.entries(state.rounds)) {
          if (round === previous.rounds[id]) continue;
          const record = this.userRecords.get(id);
          if (record !== undefined) this.read_user(record, this.read_input(record)!);
        }
      }
      // 时间元数据独立提交时也更新对应条目，覆盖刷新期间新任务到达的情况。
      if (previous.compactionStartedAt !== state.compactionStartedAt) {
        for (const [id, startedAt] of Object.entries(state.compactionStartedAt)) {
          if (startedAt !== previous.compactionStartedAt[id])
            this.pendingCompactions.add(Number(id));
        }
      }
      for (const id of this.pendingCompactions) {
        const task = this.compactions.get(id)!;
        if (this.visible(task.conversationId, id)) this.read_compaction(task);
      }
      if (this.liveChanged || previous.rounds !== state.rounds) this.read_live(this.live, stopping);
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
    this.pendingCompactions.clear();
    this.pendingUsages.clear();
    this.liveChanged = false;
  }

  /** 恢复和增量共用条目转换。分支替换只在这里清空公开索引。 */
  private reset(state: Readonly<AgentChatData>): void {
    this.state = state;
    this.rows.clear();
    this.toolCalls.clear();
    this.toolImages.clear();
    this.userRecords.clear();
    this.changed.clear();
    this.order = [];
    this.currentRound = undefined;
    this.liveId = undefined;
    this.replace = true;
    // 恢复时统一排序一次，避免每个历史压缩条目都触发插入和重排。
    this.restoring = true;
    try {
      for (const record of this.branch_records()) this.read_record(record);
      this.read_active_tools();
      for (const task of this.compactions.values()) {
        if (this.visible(task.conversationId, task.id)) this.read_compaction(task);
      }
      this.read_live(this.live);
    } finally {
      this.restoring = false;
    }
    this.order = [...this.rows.keys()];
    this.sort_order();
  }

  /** 工具已实际启动或收到结果后，才有可公开查询的条目。 */
  public tool_entry_id(callId: string): string | undefined {
    const id = this.toolCalls.get(callId)?.entry.id;
    return id !== undefined && this.rows.has(id) ? id : undefined;
  }

  /** 读取当前公开分支上工具条目的可见图片，分支切换或无图时返回 `undefined`。 */
  public read_tool_image(entry_id: string, index: number): Readonly<ImageContent> | undefined {
    return this.toolImages.get(entry_id)?.[index];
  }

  /** 发布者消费更新，不需要比较上一份完整快照。 */
  public take_change(): AgentTimelineChange {
    const result = { replace: this.replace, entries: [...this.changed.values()] };
    this.replace = false;
    this.changed.clear();
    return result;
  }

  /** 同一身份原位更新，删除或非尾部顺序变化要求发布完整快照。 */
  private put(entry: AgentEntry, order: number, rank = 0): void {
    const row = { entry, order, rank };
    const previous = this.rows.get(entry.id);
    const moved = previous !== undefined && compare_row(previous, row) !== 0;
    if (previous !== undefined && !moved && isDeepStrictEqual(previous.entry, entry)) return;
    this.rows.set(entry.id, row);
    if (this.restoring) return;
    if (previous === undefined) {
      const last = this.order.at(-1);
      this.order.push(entry.id);
      if (last !== undefined && compare_row(this.rows.get(last)!, row) > 0) {
        this.sort_order();
        this.replace = true;
      }
    } else if (moved) {
      const index = this.order.indexOf(entry.id);
      const before = this.order[index - 1];
      const after = this.order[index + 1];
      if (
        (before !== undefined && compare_row(this.rows.get(before)!, row) > 0) ||
        (after !== undefined && compare_row(this.rows.get(after)!, row) < 0)
      ) {
        this.sort_order();
        this.replace = true;
      }
    }
    this.changed.set(entry.id, entry);
  }

  /** 插入、条目移位和分支重建沿用同一顺序。 */
  private sort_order(): void {
    this.order.sort((a, b) => compare_row(this.rows.get(a)!, this.rows.get(b)!));
  }

  /** 移除已撤回的临时正文，并让前端重新取得完整顺序。 */
  private remove(id: string): void {
    if (!this.rows.delete(id)) return;
    this.changed.delete(id);
    this.order = this.order.filter((candidate) => candidate !== id);
    this.replace = true;
  }

  /** 所有投影使用同一新旧输入读取边界。 */
  private read_input(record: EntryRecord): AgentInputRecord | undefined {
    return read_agent_input(record, this.inputSubmissions.get(record.id), this.state);
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
    const input = this.read_input(record);
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
        for (const [index, call] of read_agent_tool_calls(message).entries()) {
          this.toolCalls.set(call.id, {
            recordId: record.id,
            rank: index + 1, // 同一助手条目先排正文，工具按声明顺序排列。
            entry: {
              kind: "tool_call",
              id: `tool:${record.id}:${call.id}`,
              toolName: call.name,
              input: JsonTool.stringifyStrict(call.arguments),
            },
          });
        }
      } else if (message.role === "toolResult") {
        const call = this.toolCalls.get(message.toolCallId);
        if (call === undefined) continue;
        const images = message.content.filter(
          (part): part is ImageContent =>
            part.type === "image" &&
            part.data.length > 0 &&
            SUPPORTED_RASTER_IMAGE_MIMES.has(part.mimeType),
        );
        if (images.length > 0) this.toolImages.set(call.entry.id, images);
        const duration = message.durationMs;
        const timed = duration !== undefined && Number.isFinite(duration) && duration >= 0;
        this.put(
          {
            ...call.entry,
            status: read_agent_tool_result_status(record, message),
            createdAt: timed
              ? Math.max(0, Math.round(message.timestamp - duration))
              : message.timestamp,
            endedAt: timed ? message.timestamp : null,
            output: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
            imageCount: images.length,
          },
          call.recordId,
          call.rank,
        );
      }
    }
  }

  /** 先读可见历史，再补上已启动且尚无公开条目的工具。 */
  private read_active_tools(): void {
    for (const task of this.activeToolTasks.values()) {
      const call = this.toolCalls.get(task.callId);
      if (call?.recordId !== task.assistant || this.rows.has(call.entry.id)) continue;
      this.put(
        {
          ...call.entry,
          status: "running",
          output: null,
          imageCount: 0,
          createdAt: task.startedAt,
          endedAt: null,
        },
        call.recordId,
        call.rank,
      );
    }
  }

  /** 选择切点时隐藏运行块，确认摘要范围后公开，失败保留诊断条目。 */
  private read_compaction(task: TaskRecordValue): void {
    const { status } = read_agent_compaction_result(task, this.submissions);
    const startedAt = this.state.compactionStartedAt[task.id];
    const id = `compaction:${task.id}`;
    if (
      status === "skipped" ||
      (startedAt === undefined &&
        (status === "stopped" || (status === "running" && task.state.status !== "terminal")))
    ) {
      this.remove(id);
      return;
    }
    this.put({ kind: "context_compaction", id, createdAt: startedAt ?? null, status }, task.id);
  }

  /** 流式正文沿用任务身份，正式条目以 SDK 排序身份接替临时位置。 */
  private read_live(live: Readonly<LiveState>, stopping = false): void {
    // 停止后冻结临时正文，SDK 最终回执仍可替换或撤回该条目。
    if (stopping && live.generation !== undefined) return;
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
