import type { ItemStatus } from "../domain/item";
import type { SourceFileParseFailureRecord } from "./source-file-parse-failure";

// 公开项目变更事件只能承载严格 JSON 值，避免跨进程传递可变对象或特殊类型
export type ProjectChangeJsonValue =
  | null
  | boolean
  | number
  | string
  | ProjectChangeJsonValue[]
  | { [key: string]: ProjectChangeJsonValue };

// 事件内部的对象块统一用 JSON record 表示，调用方必须先在边界收窄
export type ProjectChangeJsonRecord = Record<string, ProjectChangeJsonValue>;

// renderer 可订阅的项目数据 section；任务运行态不属于项目数据
export type ProjectDataSection =
  | "project"
  | "files"
  | "items"
  | "quality"
  | "prompts"
  | "analysis"
  | "proofreading";

// 变更事件的 payload mode 决定 renderer 是直接合并、字段 patch 还是整段补读
export type ProjectChangePayloadMode = "canonical-delta" | "field-patch" | "section-invalidated";

// section revision 只回填本次更新 section，避免消费者误判未更新 section
export type ProjectDataSectionRevisions = Partial<Record<ProjectDataSection, number>>;

// item 字段级 patch 只表达后端已提交事实中的少量校对字段，不能替代完整 DTO。
export type ProjectChangeItemFieldPatch = {
  dst?: string;
  status?: ItemStatus;
  retry_count?: number;
};

// items 支持 canonical upsert、field-patch 和 tombstone 删除三种行级表达
export type ProjectChangeItemsPayload = {
  payloadMode: ProjectChangePayloadMode;
  upsert?: Record<string, ProjectChangeJsonRecord>;
  fieldPatch?: ProjectChangeItemFieldPatch;
  changedIds?: number[];
  deleteIds?: number[];
};

// files 以相对路径为稳定 key，删除必须显式走 deletePaths tombstone
export type ProjectChangeFilesPayload = {
  payloadMode: ProjectChangePayloadMode;
  upsert?: Record<string, ProjectChangeJsonRecord>;
  changedPaths?: string[];
  deletePaths?: string[];
};

// section canonical-delta 携带后端规范 data；analysis 高频事件可只携带轻量进度块
export type ProjectChangeSectionPayload = {
  payloadMode: ProjectChangePayloadMode;
  data?: ProjectChangeJsonValue;
};

// ProjectChangeEvent 是 ApiStreamHub 对 renderer 公开的项目数据变更载荷
export type ProjectChangeEvent = {
  type: "project.changed";
  eventId: string;
  source: string;
  projectPath: string; // projectPath 是后端会话确认后的项目身份，renderer 必须用它拦截旧工程事件
  projectRevision: number;
  sectionRevisions: ProjectDataSectionRevisions;
  updatedSections: ProjectDataSection[];
  items?: ProjectChangeItemsPayload;
  files?: ProjectChangeFilesPayload;
  sections?: Partial<Record<ProjectDataSection, ProjectChangeSectionPayload>>;
};

// 同步项目写入返回和 SSE 广播共用同一批后端 canonical change
export type ProjectMutationResult = {
  accepted: true;
  changes: ProjectChangeEvent[];
  failed_files?: SourceFileParseFailureRecord[];
};

// section 顺序同时约束 manifest、项目变更和 renderer 初始化刷新顺序
/**
 * 集中维护当前模块的稳定常量。
 */
export const PROJECT_DATA_SECTIONS: readonly ProjectDataSection[] = [
  "project",
  "files",
  "items",
  "quality",
  "prompts",
  "analysis",
  "proofreading",
] as const;

// 公开 SSE topic；所有项目数据变更必须从这个 topic 进入 renderer
/**
 * 集中维护当前模块的稳定常量。
 */
export const PROJECT_CHANGE_EVENT_TOPIC = "project.data_changed";

// 字符串 section 的唯一窄化入口，防止调用点散落并行合法值判断
/**
 * 判断当前值是否满足业务条件。
 */
export function isProjectDataSection(value: string): value is ProjectDataSection {
  return (PROJECT_DATA_SECTIONS as readonly string[]).includes(value);
}

// 外部 payload 的 section 列表在边界去重，保持后续 revision 和补读逻辑稳定
/**
 * 承接当前模块的核心控制分支。
 */
export function normalizeProjectDataSections(value: unknown): ProjectDataSection[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const sections: ProjectDataSection[] = [];
  for (const section of value) {
    if (typeof section === "string" && isProjectDataSection(section)) {
      sections.push(section);
    }
  }
  return [...new Set(sections)];
}

// 坏值默认降级为 section-invalidated，让前端走补读而不是误合并
/**
 * 承接当前模块的核心控制分支。
 */
export function normalizeProjectChangePayloadMode(value: unknown): ProjectChangePayloadMode {
  if (value === "canonical-delta" || value === "field-patch" || value === "section-invalidated") {
    return value;
  }
  return "section-invalidated";
}
