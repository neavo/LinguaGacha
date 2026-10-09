import type { ProjectChangeEvent } from "../../shared/project-event";
import type { ProjectSessionState } from "./project-session-state";
import type { ProjectCommittedChange } from "./project-committed-change";
import { random_id } from "../../shared/utils/identifier";
import * as AppErrors from "../../shared/error";
/** 缓存同步后发布本次提交，非当前会话返回空结果。 */
export type ProjectChangePublisher = (change: ProjectCommittedChange) => ProjectChangeEvent | null;

/** 公开适配仅投影已提交事实，不读取数据库。 */
export function adapt_project_change(
  session_state: ProjectSessionState,
  change: ProjectCommittedChange,
): ProjectChangeEvent | null {
  const state = session_state.snapshot();
  if (change.projectPath.trim() === "")
    throw new AppErrors.AppError("runtime.internal_invariant", {
      diagnostic_context: { reason: "project_change_target_missing" },
    });
  if (!state.loaded || state.projectPath !== change.projectPath) return null;
  return {
    type: "project.changed",
    eventId: random_id(),
    source: change.source,
    projectPath: change.projectPath,
    projectRevision: Math.max(...Object.values(change.sectionRevisions), 0),
    sectionRevisions: Object.fromEntries(
      change.updatedSections.map((section) => [section, change.sectionRevisions[section]]),
    ),
    updatedSections: change.updatedSections,
    ...(change.items === undefined ? {} : { items: change.items }),
    ...(change.files === undefined ? {} : { files: change.files }),
    ...(Object.keys(change.sections).length === 0 ? {} : { sections: change.sections }),
  };
}
