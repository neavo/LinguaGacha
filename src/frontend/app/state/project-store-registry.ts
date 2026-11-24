import { createProjectFetch } from "@frontend/app/desktop/scoped-api";
import { createTranslationExportStore } from "@frontend/app/session/translation-export/translation-export-store";
import {
  createQualityRuleStatisticsStore,
  resolveQualityRuleStatisticsInvalidationScope,
} from "@frontend/app/session/quality-rule-statistics-store";
import type { ProjectTranslationStats } from "@shared/project-translation-stats";
import type { RouteId } from "@frontend/app/navigation/types";
import { is_json_record } from "@domain/json";
import { read_project_language_settings } from "@domain/project-settings";
import { read_batch_task_snapshot } from "@shared/batch-task";
import { normalize_batch_translation_snapshot } from "@shared/batch-translation/batch-translation";
import { createBatchTaskSnapshotStore } from "./batch-task-snapshot-store";
import { createBatchTranslationSnapshotStore } from "./batch-translation-snapshot-store";
import { createProjectChangeSignalStore } from "./project-change-signal-store";
import type {
  ProjectChangeApplyResult,
  ProjectChangeEventForState,
} from "./desktop-project-change-types";
import type { ProjectSnapshot } from "./desktop-state-context";
import type { ProjectSessionUiStateKey } from "@frontend/app/session/project-session-ui-state-context";

export type ProjectChatSummary = Readonly<{
  id: string;
  title: string;
  status: "idle" | "running" | "stopping";
  hasPendingDecision: boolean;
  stoppedOnError: boolean;
}>;

export type OpenProjectSnapshot = ProjectSnapshot & { projectId: string; name: string };
export type ProjectTabsSnapshot = Readonly<{
  tabs: readonly RouteId[];
  activeTab: RouteId;
}>;

const RECENT_EVENTS = 256;

/** 一个打开周期的任务镜像、缓存失效和页面状态。 */
export class ProjectStore {
  readonly batch_task = createBatchTaskSnapshotStore();
  readonly batch_translation = createBatchTranslationSnapshotStore();
  readonly projectChange = createProjectChangeSignalStore();
  readonly translationExport = createTranslationExportStore();
  readonly qualityStatistics: ReturnType<typeof createQualityRuleStatisticsStore>;
  translationStats: ProjectTranslationStats | null = null;
  readonly pageUi = new Map<ProjectSessionUiStateKey, unknown>(); // 卸载工作区时保留轻量页面状态。
  private tabs_snapshot: ProjectTabsSnapshot = Object.freeze({ tabs: [], activeTab: "agent" });
  private readonly tab_listeners = new Set<() => void>();
  activeChatId = "";
  chats: readonly ProjectChatSummary[] = [];
  private readonly applied = new Set<string>(); // HTTP 写回与 SSE 可能报告同一次提交。
  private chatsRevision = -1; // 请求回包可以晚于同一列表的 SSE。

  public snapshot: OpenProjectSnapshot;
  constructor(snapshot: OpenProjectSnapshot) {
    this.snapshot = snapshot;
    const request = createProjectFetch(snapshot.projectId);
    this.qualityStatistics = createQualityRuleStatisticsStore((rule_key) =>
      request("/api/quality/statistics/view", { rule_key }),
    );
    this.qualityStatistics.reset(snapshot.path);
  }

  public readonly subscribe_tabs = (listener: () => void): (() => void) => {
    this.tab_listeners.add(listener);
    return () => {
      this.tab_listeners.delete(listener);
    };
  };

  public readonly get_tabs_snapshot = (): ProjectTabsSnapshot => this.tabs_snapshot;

  /** 聚焦已有标签或打开新工程标签，统一通知顶栏与工作区。 */
  public select_tab(tab: RouteId): void {
    const has_tab = tab === "agent" || this.tabs_snapshot.tabs.includes(tab);
    if (has_tab && this.tabs_snapshot.activeTab === tab) return;
    const tabs = has_tab ? this.tabs_snapshot.tabs : [...this.tabs_snapshot.tabs, tab];
    this.tabs_snapshot = Object.freeze({ tabs, activeTab: tab });
    for (const listener of this.tab_listeners) listener();
  }

  /** 关闭工程标签，若当前激活则平滑回到对话标签。 */
  public close_tab(tab: RouteId): void {
    if (!this.tabs_snapshot.tabs.includes(tab)) return;
    const tabs = this.tabs_snapshot.tabs.filter((candidate) => candidate !== tab);
    const activeTab = this.tabs_snapshot.activeTab === tab ? "agent" : this.tabs_snapshot.activeTab;
    this.tabs_snapshot = Object.freeze({ tabs, activeTab });
    for (const listener of this.tab_listeners) listener();
  }

  /** 采用较新的对话列表与活跃指针。 */
  public update_chats(payload: unknown): void {
    if (!is_json_record(payload) || !Array.isArray(payload.chats)) return;
    if (typeof payload.chatsRevision === "number") {
      if (payload.chatsRevision < this.chatsRevision) return;
      this.chatsRevision = payload.chatsRevision;
    }
    const chats = payload.chats.flatMap((value): ProjectChatSummary[] => {
      if (!is_json_record(value) || typeof value.id !== "string") return [];
      return [
        {
          id: value.id,
          title: typeof value.title === "string" ? value.title : "",
          status: value.status === "running" || value.status === "stopping" ? value.status : "idle",
          hasPendingDecision: value.hasPendingDecision === true,
          stoppedOnError: value.stoppedOnError === true,
        },
      ];
    });
    this.chats = chats;
    this.activeChatId =
      typeof payload.activeChatId === "string" &&
      chats.some((chat) => chat.id === payload.activeChatId)
        ? payload.activeChatId
        : (chats[0]?.id ?? "");
  }

  /** 任务回执可只含公共批次，独立翻译镜像只消费明确携带的快照。 */
  public update_task(payload: Record<string, unknown>): void {
    this.batch_task.applySnapshot(read_batch_task_snapshot(payload));
    if ("batch_translation" in payload)
      this.batch_translation.applySnapshot(normalize_batch_translation_snapshot(payload));
  }

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
  private readonly stores = new Map<string, ProjectStore>();
  public get(projectId: string): ProjectStore | undefined {
    return this.stores.get(projectId);
  }
  public values(): ProjectStore[] {
    return [...this.stores.values()];
  }

  /** 以服务端完整列表为准，关闭的工程退出登记。 */
  public replace(payload: unknown): void {
    if (!is_json_record(payload) || !Array.isArray(payload.projects)) return;
    const loaded = new Set<string>();
    for (const value of payload.projects) {
      const store = this.update(value);
      if (store) loaded.add(store.snapshot.projectId);
    }
    for (const id of this.stores.keys()) if (!loaded.has(id)) this.stores.delete(id);
  }

  /** 单工程补读只更新公共快照，页面和高频 Store 继续使用原实例。 */
  public update(payload: unknown): ProjectStore | undefined {
    if (!is_json_record(payload) || !is_json_record(payload.project)) return;
    const { project } = payload;
    if (typeof project.projectId !== "string" || typeof project.path !== "string") return;
    const snapshot: OpenProjectSnapshot = {
      projectId: project.projectId,
      path: project.path,
      name: typeof project.name === "string" ? project.name : project.path,
      loaded: true,
      file_count: typeof project.file_count === "number" ? project.file_count : 0,
      languages: is_json_record(project.languages)
        ? read_project_language_settings(project.languages)
        : null,
    };
    const store = this.stores.get(snapshot.projectId) ?? new ProjectStore(snapshot);
    store.snapshot = snapshot;
    store.update_chats(payload);
    this.stores.set(snapshot.projectId, store);
    return store;
  }
}
