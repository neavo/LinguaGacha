import type { SourceFileParseFailureRecord } from "./source-file-parse-failure";

// section 顺序同时约束 manifest、项目变更和 renderer 初始化刷新顺序
export const PROJECT_DATA_SECTIONS = [
  "project",
  "files",
  "items",
  "pdf",
  "quality",
  "prompts",
  "proofreading",
] as const;

// renderer 可订阅工程数据分区。任务运行态有独立快照。
export type ProjectDataSection = (typeof PROJECT_DATA_SECTIONS)[number];

// section revision 只回填本次更新 section。
export type ProjectDataSectionRevisions = Partial<Record<ProjectDataSection, number>>;

/** 事务确定统计文本影响，前后端消费同一失效范围。 */
export type QualityStatisticsTextChangeScope = "none" | "post_replacement" | "all";

/** 前端据此选择重查或刷新已有窗口。 */
export type ProjectItemsChange =
  | Readonly<{ mode: "full" }>
  | Readonly<{ mode: "delta"; changedIds: readonly number[] }>;

// ApiStreamHub 对 renderer 公开的项目数据变更载荷
export type ProjectChangeEvent = {
  type: "project.changed";
  eventId: string;
  source: string;
  projectPath: string; // 后端会话确认后的项目身份，renderer 必须用它拦截旧工程事件
  projectRevision: number;
  sectionRevisions: ProjectDataSectionRevisions;
  updatedSections: ProjectDataSection[];
  items?: ProjectItemsChange;
  qualityStatisticsScope: QualityStatisticsTextChangeScope;
};

// 同步项目写入返回和 SSE 广播共用同一批后端变更通知
export type ProjectWriteResult = {
  accepted: true;
  changes: ProjectChangeEvent[];
  failed_files?: SourceFileParseFailureRecord[];
};

// 公开的工程数据变更 SSE 主题，renderer 从此入口消费工程变化。

export const PROJECT_CHANGE_EVENT_TOPIC = "project.data_changed";

// 字符串 section 的唯一窄化入口，防止调用点散落并行合法值判断

export function isProjectDataSection(value: string): value is ProjectDataSection {
  return (PROJECT_DATA_SECTIONS as readonly string[]).includes(value);
}
