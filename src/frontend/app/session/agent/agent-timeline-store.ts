import type { AgentEntry } from "@shared/agent";

type Listener = () => void;
export type AgentTimelineSlice = Readonly<{
  entryIds: readonly string[];
  roundIds: readonly string[];
  latestRoundId: string | null;
  workspaceApplyRunning: boolean;
  compacting: boolean;
}>;
const EMPTY_IDS: readonly string[] = [];

/** 条目内容和显示结构分别订阅。组件读到的条目和 ID 数组始终是不可变快照。 */
export class AgentTimelineStore {
  private readonly entries = new Map<string, AgentEntry>(); // 公开条目的唯一内容副本
  private readonly rounds = new Map<string, readonly string[]>(); // 轮次到有序条目身份的索引
  private readonly assistants = new Map<string, string>(); // 各轮次末条助手回复的身份
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly structureListeners = new Set<Listener>();
  private readonly changed = new Set<string>(); // 本批需要通知的条目身份，重复更新只通知一次
  private structureChanged = false;
  private applyCount = 0; // 运行中的工程提交工具数，驱动停止能力
  private lastCompaction: string | null = null; // 最近压缩条目的身份
  private snapshot: AgentTimelineSlice = {
    entryIds: [],
    roundIds: [],
    latestRoundId: null,
    workspaceApplyRunning: false,
    compacting: false,
  };

  /** 返回稳定结构快照，供 React 判断是否需要更新容器。 */
  public readonly read = (): AgentTimelineSlice => this.snapshot;
  /** 按当前选择读取条目，未选择或已移除时返回空值。 */
  public entry(id: string | null): AgentEntry | undefined {
    return id === null ? undefined : this.entries.get(id);
  }
  /** 读取一个轮次的条目顺序，缺失轮次共用稳定空数组。 */
  public round(id: string): readonly string[] {
    return this.rounds.get(id) ?? EMPTY_IDS;
  }
  /** 定位轮次末条助手回复，供修订入口判断。 */
  public latest_assistant(id: string): string | undefined {
    return this.assistants.get(id);
  }
  /** 订阅顺序和操作状态变化，返回监听器清理入口。 */
  public readonly subscribe = (listener: Listener): (() => void) => {
    this.structureListeners.add(listener);
    return () => {
      this.structureListeners.delete(listener);
    };
  };
  /** 订阅指定条目，清理时回收已无读者的监听集合。 */
  public subscribe_entry(id: string | null, listener: Listener): () => void {
    if (id === null) return () => {};
    let listeners = this.listeners.get(id);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(id, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(id);
    };
  }

  /** 完整快照使消失的条目也通知原订阅者，避免详情或编辑器持有旧对象。 */
  public replace(entries: readonly AgentEntry[]): void {
    for (const id of this.entries.keys()) this.changed.add(id);
    this.entries.clear();
    this.rounds.clear();
    this.assistants.clear();
    this.applyCount = 0;
    this.lastCompaction = null;
    this.snapshot = {
      entryIds: [],
      roundIds: [],
      latestRoundId: null,
      workspaceApplyRunning: false,
      compacting: false,
    };
    this.structureChanged = true;
    this.update(entries);
  }

  /** 应用批次中的条目，追加身份时同步维护轮次索引。 */
  public update(entries: readonly AgentEntry[]): void {
    const addedIds: string[] = [];
    const addedRounds: string[] = [];
    let latestRoundId = this.snapshot.latestRoundId;
    const roundAdditions = new Map<string, string[]>();
    for (const entry of entries) {
      const previous = this.entries.get(entry.id);
      if (previous === entry) continue;
      if (
        previous?.kind === "tool_call" &&
        previous.toolName === "workspace_apply" &&
        previous.status === "running"
      )
        this.applyCount--;
      if (
        entry.kind === "tool_call" &&
        entry.toolName === "workspace_apply" &&
        entry.status === "running"
      )
        this.applyCount++;
      this.entries.set(entry.id, entry);
      this.changed.add(entry.id);
      if (previous !== undefined) continue;
      addedIds.push(entry.id);
      if (entry.kind === "context_compaction") this.lastCompaction = entry.id;
      if (entry.kind === "user_message" && entry.delivery === "round") {
        latestRoundId = entry.id;
        addedRounds.push(entry.id);
        this.rounds.set(entry.id, EMPTY_IDS);
      } else if (latestRoundId !== null) {
        const additions = roundAdditions.get(latestRoundId) ?? [];
        additions.push(entry.id);
        roundAdditions.set(latestRoundId, additions);
        if (entry.kind === "assistant_message") this.assistants.set(latestRoundId, entry.id);
      }
    }
    for (const [id, additions] of roundAdditions)
      this.rounds.set(id, [...this.round(id), ...additions]);
    const compacting = this.entry(this.lastCompaction)?.status === "running";
    const workspaceApplyRunning = this.applyCount > 0;
    if (
      addedIds.length > 0 ||
      compacting !== this.snapshot.compacting ||
      workspaceApplyRunning !== this.snapshot.workspaceApplyRunning
    ) {
      this.snapshot = {
        entryIds:
          addedIds.length === 0 ? this.snapshot.entryIds : [...this.snapshot.entryIds, ...addedIds],
        roundIds:
          addedRounds.length === 0
            ? this.snapshot.roundIds
            : [...this.snapshot.roundIds, ...addedRounds],
        latestRoundId,
        compacting,
        workspaceApplyRunning,
      };
      this.structureChanged = true;
    }
  }

  /** 同一传输批次的其他切片已更新后，才通知组件读取。 */
  public notify(): void {
    const ids = [...this.changed];
    this.changed.clear();
    const structureChanged = this.structureChanged;
    this.structureChanged = false;
    if (structureChanged) for (const listener of this.structureListeners) listener();
    for (const id of ids) for (const listener of this.listeners.get(id) ?? []) listener();
  }
}
