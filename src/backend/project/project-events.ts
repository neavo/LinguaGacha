import type {
  ProjectChangeFilesPayload,
  ProjectChangeItemsPayload,
  ProjectChangeSectionPayload,
  ProjectDataSection,
  ProjectDataSectionRevisions,
} from "../../shared/project-event";

// Backend 内部 committed event 词表，和公开 SSE topic 分离。
export type ProjectEventType =
  | "project.opened_for_cache"
  | "project.unloaded"
  | "project.items.changed"
  | "project.quality.changed"
  | "project.prompts.changed"
  | "project.settings.changed"
  | "project.analysis.changed";

// 标识写入来源，用于缓存诊断和 after-commit 事件追踪。
export type ProjectEventSource =
  | "project_lifecycle"
  | "project_write"
  | "proofreading"
  | "quality"
  | "task"
  | "cli"
  | "settings";

// 固定所有项目事件都必须携带工程身份和后端 section revision。
type BaseProjectEvent<TType extends ProjectEventType> = {
  type: TType;
  projectPath: string;
  source: ProjectEventSource | string;
  affectedSections: ProjectDataSection[];
  sectionRevisions: ProjectDataSectionRevisions;
  reason?: string;
};

// loaded 工程缓存可以开始热机。
export type ProjectOpenedForCacheEvent = BaseProjectEvent<"project.opened_for_cache"> & {
  affectedSections: ProjectDataSection[];
};

// 只用于清理当前工程缓存，不携带 section 内容。
export type ProjectUnloadedEvent = BaseProjectEvent<"project.unloaded"> & {
  affectedSections: [];
  sectionRevisions: {};
};

// 汇总 item / file 事务提交后的缓存刷新范围。
export type ProjectItemsChangedEvent = BaseProjectEvent<"project.items.changed"> & {
  affectedSections: ProjectDataSection[];
  items?: ProjectChangeItemsPayload;
  files?: ProjectChangeFilesPayload;
  scope?: "items-partial" | "items-full";
};

// 汇总质量规则或质量计算缓存的刷新范围。
export type ProjectQualityChangedEvent = BaseProjectEvent<"project.quality.changed"> & {
  affectedSections: ProjectDataSection[];
  ruleTypes?: string[];
  scope?: "quality-partial" | "quality-full";
};

// 汇总提示词规则的刷新范围。
export type ProjectPromptsChangedEvent = BaseProjectEvent<"project.prompts.changed"> & {
  affectedSections: ProjectDataSection[];
  promptTypes?: string[];
  scope?: "prompts-partial" | "prompts-full";
};

// 项目设置写入影响了后端 query 依赖。
export type ProjectSettingsChangedEvent = BaseProjectEvent<"project.settings.changed"> & {
  affectedSections: ProjectDataSection[];
  changedKeys?: string[];
};

// 汇总分析候选或分析状态的刷新范围。
export type ProjectAnalysisChangedEvent = BaseProjectEvent<"project.analysis.changed"> & {
  affectedSections: ProjectDataSection[];
  sections?: Partial<Record<ProjectDataSection, ProjectChangeSectionPayload>>;
  scope?: "analysis-partial" | "analysis-full";
};

// Backend 内部事件总线唯一事件联合类型。
export type ProjectEvent =
  | ProjectOpenedForCacheEvent
  | ProjectUnloadedEvent
  | ProjectItemsChangedEvent
  | ProjectQualityChangedEvent
  | ProjectPromptsChangedEvent
  | ProjectSettingsChangedEvent
  | ProjectAnalysisChangedEvent;

// 供订阅者按事件名获得窄化 payload。
export type ProjectEventOfType<TType extends ProjectEventType> = Extract<
  ProjectEvent,
  { type: TType }
>;

/**
 * 创建工程热机事件；affectedSections 固定为全量项目 section，避免加载期漏热缓存。
 */
export function create_project_opened_for_cache_event(args: {
  projectPath: string;
  source?: ProjectEventSource | string;
  sectionRevisions: ProjectDataSectionRevisions;
}): ProjectOpenedForCacheEvent {
  return {
    type: "project.opened_for_cache",
    projectPath: args.projectPath,
    source: args.source ?? "project_lifecycle",
    affectedSections: [
      "project",
      "files",
      "items",
      "quality",
      "prompts",
      "analysis",
      "proofreading",
    ],
    sectionRevisions: { ...args.sectionRevisions },
  };
}

/**
 * 创建工程卸载事件；清理事件不继承旧 revision，避免误作事实刷新。
 */
export function create_project_unloaded_event(projectPath: string): ProjectUnloadedEvent {
  return {
    type: "project.unloaded",
    projectPath,
    source: "project_lifecycle",
    affectedSections: [],
    sectionRevisions: {},
  };
}

// Backend 内部 committed event 的订阅入口，按事件类型收窄 payload。
export type ProjectEventHandler<TType extends ProjectEventType = ProjectEventType> = (
  event: ProjectEventOfType<TType>,
) => void | Promise<void>;

// 保留每个订阅者的执行结果，调用方可决定是否阻断后续发布链路。
export type ProjectEventDispatchResult = {
  type: ProjectEventType;
  handlerIndex: number;
  ok: boolean;
  error?: unknown;
};

type ProjectEventHandlerEntry = {
  type: ProjectEventType;
  handler: (event: ProjectEvent) => void | Promise<void>;
};

// Backend 内部事务提交后事件分发器，不直接承担公开 SSE 或 renderer 刷新策略。
export class ProjectEventBus {
  private readonly handlers: ProjectEventHandlerEntry[] = [];

  /**
   * 订阅指定 committed event，并返回幂等取消函数。
   */
  public subscribe<TType extends ProjectEventType>(
    type: TType,
    handler: ProjectEventHandler<TType>,
  ): () => void {
    const entry: ProjectEventHandlerEntry = {
      type,
      handler: (event) => handler(event as ProjectEventOfType<TType>),
    };
    this.handlers.push(entry);
    return () => {
      const index = this.handlers.indexOf(entry);
      if (index >= 0) {
        this.handlers.splice(index, 1);
      }
    };
  }

  /**
   * 按订阅顺序等待所有 handler；单个 handler 失败会记录结果并继续分发后续订阅者。
   */
  public async publish(event: ProjectEvent): Promise<ProjectEventDispatchResult[]> {
    const results: ProjectEventDispatchResult[] = [];
    const handlers = this.handlers.filter((entry) => entry.type === event.type);
    for (const [handler_index, entry] of handlers.entries()) {
      try {
        await entry.handler(event as never);
        results.push({
          type: event.type,
          handlerIndex: handler_index,
          ok: true,
        });
      } catch (error) {
        results.push({
          type: event.type,
          handlerIndex: handler_index,
          ok: false,
          error,
        });
      }
    }
    return results;
  }
}
