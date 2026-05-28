import {
  isProjectDataSection,
  type ProjectChangeFilesPayload,
  type ProjectChangeItemFieldPatch,
  type ProjectChangeItemsPayload,
  type ProjectChangePayloadMode,
  type ProjectDataSection,
  type ProjectDataSectionRevisions,
} from "@shared/project-event";

// ProjectRuntimeStage 沿用后端公开 section 词表，renderer 不再维护额外项目阶段名。
export type ProjectRuntimeStage = ProjectDataSection;

// ProjectRuntimeSectionRevisions 是项目刷新信号携带的可选 revision 集合。
export type ProjectRuntimeSectionRevisions = Partial<Record<ProjectRuntimeStage, number>>;

// ProjectDataRevisionCheckpoint 表示页面 mutation 依赖的项目身份与 section revision。
export type ProjectDataRevisionCheckpoint = {
  projectPath: string;
  sections: ProjectDataSectionRevisions;
};

// ProjectRuntimeChangeSectionPayload 只保留页面判断是否需要重新 query 的 payload mode。
export type ProjectRuntimeChangeSectionPayload = {
  payloadMode: ProjectChangePayloadMode;
  data?: unknown;
};

// ProjectRuntimeChangeOperation 是 renderer 归一化后的项目变更操作摘要。
export type ProjectRuntimeChangeOperation = {
  items?: ProjectChangeItemsPayload;
  files?: ProjectChangeFilesPayload;
  sections?: Partial<Record<ProjectDataSection, ProjectRuntimeChangeSectionPayload>>;
};

// ProjectRuntimeChangeEvent 是 mutation result 与 SSE 共用的 renderer 内部事件形状。
export type ProjectRuntimeChangeEvent = {
  eventId?: string;
  source: string;
  projectPath: string;
  projectRevision: number;
  updatedSections: ProjectRuntimeStage[];
  operations: ProjectRuntimeChangeOperation[];
  sectionRevisions?: ProjectRuntimeSectionRevisions;
};

// ProjectRuntimeChangeApplyResult 是页面 runtime 消费的轻量刷新信号。
export type ProjectRuntimeChangeApplyResult = {
  applied: boolean;
  eventId?: string;
  source: string;
  projectRevision: number;
  updatedSections: ProjectRuntimeStage[];
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
  sectionRevisions: ProjectRuntimeSectionRevisions;
};

/**
 * 校验项目刷新信号里的 section 名，丢弃后端协议之外的字段。
 */
export function is_project_runtime_stage(value: string): value is ProjectRuntimeStage {
  return isProjectDataSection(value);
}
