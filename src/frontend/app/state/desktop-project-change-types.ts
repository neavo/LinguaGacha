import {
  isProjectDataSection,
  type ProjectChangeEvent,
  type ProjectDataSection,
} from "@shared/project-event";

export type ProjectStage = ProjectDataSection;
export type ProjectSectionRevisions = Partial<Record<ProjectStage, number>>;

/** HTTP 回流与 SSE 沿用同一通知契约。 */
export type ProjectChangeEventForState = Omit<ProjectChangeEvent, "type">;

/** 页面消费通知身份、变化范围和事务确定的统计失效范围。 */
export type ProjectChangeApplyResult = Omit<
  ProjectChangeEventForState,
  "projectPath" | "eventId"
> & {
  applied: boolean;
  eventId?: string;
};

/** 沿用共享分区词表，运行态与公开通知使用同一合法值。 */
export function is_project_stage(value: string): value is ProjectStage {
  return isProjectDataSection(value);
}
