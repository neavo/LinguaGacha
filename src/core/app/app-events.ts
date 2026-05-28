import type {
  ProjectChangeFilesPayload,
  ProjectChangeItemsPayload,
  ProjectChangeSectionPayload,
  ProjectDataSection,
  ProjectDataSectionRevisions,
} from "../../shared/project-event";

// AppEventType 是 Core 内部 committed event 词表，和公开 SSE topic 分离。
export type AppEventType =
  | "project.opened_for_cache"
  | "project.unloaded"
  | "project.items.changed"
  | "project.quality.changed"
  | "project.prompts.changed"
  | "project.settings.changed"
  | "project.analysis.changed";

// AppEventSource 标识写入来源，用于缓存诊断和 after-commit 事件追踪。
export type AppEventSource =
  | "project_lifecycle"
  | "project_mutation"
  | "proofreading"
  | "quality"
  | "task"
  | "cli"
  | "settings";

// BaseProjectAppEvent 固定所有项目事件都必须携带工程身份和后端 section revision。
type BaseProjectAppEvent<TType extends AppEventType> = {
  type: TType;
  projectPath: string;
  source: AppEventSource | string;
  affectedSections: ProjectDataSection[];
  sectionRevisions: ProjectDataSectionRevisions;
  reason?: string;
};

// ProjectOpenedForCacheEvent 表示 loaded 工程缓存可以开始热机。
export type ProjectOpenedForCacheEvent = BaseProjectAppEvent<"project.opened_for_cache"> & {
  affectedSections: ProjectDataSection[];
};

// ProjectUnloadedEvent 只用于清理当前工程缓存，不携带 section 内容。
export type ProjectUnloadedEvent = BaseProjectAppEvent<"project.unloaded"> & {
  affectedSections: [];
  sectionRevisions: {};
};

// ProjectItemsChangedEvent 汇总 item / file 事务提交后的缓存刷新范围。
export type ProjectItemsChangedEvent = BaseProjectAppEvent<"project.items.changed"> & {
  affectedSections: ProjectDataSection[];
  items?: ProjectChangeItemsPayload;
  files?: ProjectChangeFilesPayload;
  scope?: "items-partial" | "items-full";
};

// ProjectQualityChangedEvent 汇总质量规则或质量派生缓存的刷新范围。
export type ProjectQualityChangedEvent = BaseProjectAppEvent<"project.quality.changed"> & {
  affectedSections: ProjectDataSection[];
  ruleTypes?: string[];
  scope?: "quality-partial" | "quality-full";
};

// ProjectPromptsChangedEvent 汇总提示词规则的刷新范围。
export type ProjectPromptsChangedEvent = BaseProjectAppEvent<"project.prompts.changed"> & {
  affectedSections: ProjectDataSection[];
  promptTypes?: string[];
  scope?: "prompts-partial" | "prompts-full";
};

// ProjectSettingsChangedEvent 表示项目设置写入影响了后端 query 依赖。
export type ProjectSettingsChangedEvent = BaseProjectAppEvent<"project.settings.changed"> & {
  affectedSections: ProjectDataSection[];
  changedKeys?: string[];
};

// ProjectAnalysisChangedEvent 汇总分析候选或分析状态的刷新范围。
export type ProjectAnalysisChangedEvent = BaseProjectAppEvent<"project.analysis.changed"> & {
  affectedSections: ProjectDataSection[];
  sections?: Partial<Record<ProjectDataSection, ProjectChangeSectionPayload>>;
  scope?: "analysis-partial" | "analysis-full";
};

// AppEvent 是 Core 内部事件总线唯一事件联合类型。
export type AppEvent =
  | ProjectOpenedForCacheEvent
  | ProjectUnloadedEvent
  | ProjectItemsChangedEvent
  | ProjectQualityChangedEvent
  | ProjectPromptsChangedEvent
  | ProjectSettingsChangedEvent
  | ProjectAnalysisChangedEvent;

// AppEventOfType 供订阅者按事件名获得窄化 payload。
export type AppEventOfType<TType extends AppEventType> = Extract<AppEvent, { type: TType }>;

/**
 * 创建工程热机事件；affectedSections 固定为全量项目 section，避免加载期漏热缓存。
 */
export function create_project_opened_for_cache_event(args: {
  projectPath: string;
  source?: AppEventSource | string;
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
