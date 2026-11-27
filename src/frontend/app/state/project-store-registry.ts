import { AgentChatStore } from "@frontend/app/session/agent/agent-chat-store";
import { createProjectFetch } from "@frontend/app/desktop/scoped-api";
import { createTranslationExportStore } from "@frontend/app/session/translation-export/translation-export-store";
import {
  createQualityRuleStatisticsStore,
  resolveQualityRuleStatisticsInvalidationScope,
} from "@frontend/app/session/quality-rule-statistics-store";
import type { ProjectTranslationStats } from "@shared/project-translation-stats";
import type { RouteId } from "@frontend/app/navigation/types";
import { is_json_record } from "@domain/json";
import { read_project_settings } from "@domain/project-settings";
import { read_batch_task_list_snapshot } from "@shared/batch-task";
import { createBatchTaskSnapshotStore } from "./batch-task-snapshot-store";
import { createProjectChangeSignalStore } from "./project-change-signal-store";
import type {
  ProjectChangeApplyResult,
  ProjectChangeEventForState,
} from "./desktop-project-change-types";
import type { ProjectSnapshot, QualityRuleCounts } from "./desktop-state-context";
import type { ProjectSessionUiStateKey } from "@frontend/app/session/project-session-ui-state-context";

export type OpenProjectSnapshot = ProjectSnapshot & {
  projectId: string;
  name: string;
  quality_rule_counts: QualityRuleCounts;
};

const RECENT_EVENTS = 256;
type AgentErrorHandler = ConstructorParameters<typeof AgentChatStore>[1];

/** 将后端快照中的列表型质量规则条数规范化为冻结对象，缺失字段统一回落到 0。 */
function read_quality_rule_counts(value: unknown): QualityRuleCounts {
  const record = is_json_record(value) ? value : {};
  const count = (key: keyof QualityRuleCounts): number =>
    typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : 0;
  return Object.freeze({
    glossary: count("glossary"),
    text_preserve: count("text_preserve"),
    pre_replacement: count("pre_replacement"),
    post_replacement: count("post_replacement"),
  });
}

/** 单工程回执和工程列表使用同一快照形状。 */
function read_open_project_snapshot(payload: unknown): OpenProjectSnapshot | undefined {
  if (!is_json_record(payload) || !is_json_record(payload.project)) return;
  const { project } = payload;
  if (typeof project.projectId !== "string" || typeof project.path !== "string") return;
  return {
    projectId: project.projectId,
    path: project.path,
    name: typeof project.name === "string" ? project.name : project.path,
    loaded: true,
    file_count: typeof project.file_count === "number" ? project.file_count : 0,
    quality_rule_counts: read_quality_rule_counts(project.quality_rule_counts),
    settings: is_json_record(project.settings) ? read_project_settings(project.settings) : null,
  };
}

/** 一个打开周期的任务镜像、缓存失效和页面状态。 */
export class ProjectStore {
  readonly batch_task = createBatchTaskSnapshotStore();
  readonly projectChange = createProjectChangeSignalStore();
  readonly translationExport = createTranslationExportStore();
  readonly qualityStatistics: ReturnType<typeof createQualityRuleStatisticsStore>;
  translationStats: ProjectTranslationStats | null = null;
  readonly pageUi = new Map<ProjectSessionUiStateKey, unknown>(); // 卸载工作区时保留轻量页面状态。
  private active_route: RouteId = "agent";
  private readonly route_listeners = new Set<() => void>();
  readonly agentChat: AgentChatStore; // 前台卸载后仍接收事件，直到工程关闭。
  private readonly applied = new Set<string>(); // HTTP 写回与 SSE 可能报告同一次提交。

  public snapshot: OpenProjectSnapshot; // 注册表只替换公共快照，保留订阅中的 Store。

  /** 为本次工程打开周期绑定对话和统计请求。 */
  constructor(snapshot: OpenProjectSnapshot, on_agent_error: AgentErrorHandler = () => {}) {
    this.snapshot = snapshot;
    this.agentChat = new AgentChatStore(window.localStorage, on_agent_error, snapshot.projectId);
    const request = createProjectFetch(snapshot.projectId);
    this.qualityStatistics = createQualityRuleStatisticsStore((rule_key) =>
      request("/api/quality/statistics/view", { rule_key }),
    );
    this.qualityStatistics.reset(snapshot.path);
  }

  public readonly subscribe_route = (listener: () => void): (() => void) => {
    this.route_listeners.add(listener);
    return () => {
      this.route_listeners.delete(listener);
    };
  };

  public readonly get_active_route = (): RouteId => this.active_route;

  /** 切换工程内当前页面，回到对话时同步关闭已展开的功能页。 */
  public select_route(route: RouteId): void {
    if (this.active_route === route) return;
    this.active_route = route;
    for (const listener of this.route_listeners) listener();
  }

  /** 启停响应和 SSE 都通过当前工程的任务镜像写入口。 */
  public readonly update_task = (payload: Record<string, unknown>): void => {
    const accepted_run_id = typeof payload["run_id"] === "string" ? payload["run_id"] : undefined;
    this.batch_task.applySnapshot(read_batch_task_list_snapshot(payload), accepted_run_id);
  };

  /** 各工程独立消化写回，只发布一次失效信号。 */
  public apply_event(event: ProjectChangeEventForState): boolean {
    if (event.projectId !== this.snapshot.projectId || this.applied.has(event.eventId))
      return false;
    this.applied.add(event.eventId);
    if (this.applied.size > RECENT_EVENTS) this.applied.delete(this.applied.values().next().value!);
    this.publish_change({ ...event, applied: true });
    return true;
  }

  /** 实时写入和断线补读共用统计失效范围。 */
  public publish_change(result: ProjectChangeApplyResult): void {
    this.qualityStatistics.applyInvalidation(
      resolveQualityRuleStatisticsInvalidationScope([result]),
    );
    this.projectChange.applySnapshot({
      seq: this.projectChange.getSnapshot().seq + 1,
      updated_sections: result.updatedSections,
      reason: result.source,
      results: [result],
    });
  }
}

/** 工程列表刷新时保留仍处于同一打开周期的 Store。 */
export class ProjectStoreRegistry {
  private stores = new Map<string, ProjectStore>();
  private readonly on_agent_error: AgentErrorHandler;

  constructor(on_agent_error: AgentErrorHandler) {
    this.on_agent_error = on_agent_error;
  }

  /** 应用卸载时释放全部工程的 Agent 订阅和上传。 */
  public dispose(): void {
    for (const store of this.stores.values()) store.agentChat.dispose();
    this.stores.clear();
  }

  public get(projectId: string): ProjectStore | undefined {
    return this.stores.get(projectId);
  }
  public values(): ProjectStore[] {
    return [...this.stores.values()];
  }

  /** 只有完整工程列表能决定哪些打开周期已经结束。 */
  public replace(payload: unknown): void {
    if (!is_json_record(payload) || !Array.isArray(payload.projects)) return;
    const loaded = new Set<string>();
    for (const value of payload.projects) {
      const store = this.update(value);
      if (store) loaded.add(store.snapshot.projectId);
    }
    for (const [id, store] of this.stores) {
      if (loaded.has(id)) continue;
      store.agentChat.dispose();
      this.stores.delete(id);
    }
  }

  /** 单工程补读只更新公共快照，页面和高频 Store 继续使用原实例。 */
  public update(payload: unknown): ProjectStore | undefined {
    const snapshot = read_open_project_snapshot(payload);
    if (snapshot !== undefined) return this.apply_snapshot(snapshot);
  }

  /** 改名沿用列表位置和用户输入。缓存及上传任务归旧周期释放。 */
  public replace_renamed_project(previous_id: string, payload: unknown): ProjectStore | undefined {
    const snapshot = read_open_project_snapshot(payload);
    if (snapshot === undefined) return;
    const previous = this.stores.get(previous_id);
    if (previous === undefined || snapshot.projectId === previous_id)
      return this.apply_snapshot(snapshot);

    const store = new ProjectStore(snapshot, this.on_agent_error);
    store.select_route(previous.get_active_route());
    previous.agentChat.dispose(); // 清除在途上传，剩余草稿可交给新周期。
    store.agentChat.get_input().draft.write(previous.agentChat.get_input().draft.read());
    this.stores = new Map(
      [...this.stores].map(([id, current]) =>
        id === previous_id ? [snapshot.projectId, store] : [id, current],
      ),
    );
    store.agentChat.connect();
    return store;
  }

  /** 同一周期只刷新快照，首次登记才建立 Agent 连接。 */
  private apply_snapshot(snapshot: OpenProjectSnapshot): ProjectStore {
    const previous = this.stores.get(snapshot.projectId);
    if (previous !== undefined) {
      previous.snapshot = snapshot;
      return previous;
    }
    const store = new ProjectStore(snapshot, this.on_agent_error);
    this.stores.set(snapshot.projectId, store);
    store.agentChat.connect();
    return store;
  }
}
