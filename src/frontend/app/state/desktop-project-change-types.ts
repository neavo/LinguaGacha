import {
  isProjectDataSection,
  type ProjectChangeFilesPayload,
  type ProjectChangeItemFieldPatch,
  type ProjectChangeItemsPayload,
  type ProjectChangePayloadMode,
  type ProjectDataSection,
  type ProjectDataSectionRevisions,
} from "@shared/project-event";

// ProjectStage 沿用后端公开 section 词表，渲染进程不再维护额外项目阶段名。
export type ProjectStage = ProjectDataSection;

// ProjectSectionRevisions 是项目刷新信号携带的可选 revision 集合。
export type ProjectSectionRevisions = Partial<Record<ProjectStage, number>>;

// ProjectDataRevisionCheckpoint 表示页面写入依赖的项目身份与 section revision。
export type ProjectDataRevisionCheckpoint = {
  projectPath: string;
  sections: ProjectDataSectionRevisions;
};

// ProjectChangeSectionPayload 只保留页面判断是否需要重新 query 的 payload mode。
export type ProjectChangeSectionPayload = {
  payloadMode: ProjectChangePayloadMode;
  data?: unknown;
};

// ProjectChangeOperation 是渲染进程归一化后的项目变更操作摘要。
export type ProjectChangeOperation = {
  items?: ProjectChangeItemsPayload;
  files?: ProjectChangeFilesPayload;
  sections?: Partial<Record<ProjectDataSection, ProjectChangeSectionPayload>>;
};

// ProjectChangeEventForState 是写入结果与 SSE 共用的渲染进程内部事件形状。
export type ProjectChangeEventForState = {
  eventId?: string;
  source: string;
  projectPath: string;
  projectRevision: number;
  updatedSections: ProjectStage[];
  operations: ProjectChangeOperation[];
  sectionRevisions?: ProjectSectionRevisions;
};

// ProjectChangeApplyResult 是页面 state 消费的轻量刷新信号。
export type ProjectChangeApplyResult = {
  applied: boolean;
  eventId?: string;
  source: string;
  projectRevision: number;
  updatedSections: ProjectStage[];
  itemDelta?: {
    upsertItemIds: Array<number | string>;
    deleteItemIds: Array<number | string>;
    fieldPatch?: ProjectChangeItemFieldPatch;
    fullReplace: boolean;
  };
  fileDelta?: {
    upsertFilePaths: string[];
    deleteFilePaths: string[];
    fullReplace: boolean;
  };
  sectionRevisions: ProjectSectionRevisions;
};

/**
 * 校验项目刷新信号里的 section 名，丢弃后端协议之外的字段。
 */
export function is_project_stage(value: string): value is ProjectStage {
  return isProjectDataSection(value);
}
