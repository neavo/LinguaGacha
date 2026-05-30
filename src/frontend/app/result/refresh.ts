import {
  create_result_refresh,
  should_rebuild_result,
  type PendingResultRefresh,
  type ResultRefreshPolicy,
  type ResultSource,
} from "./snapshot";
import type { ProjectWriteResult } from "@frontend/app/state/desktop-project-write";
import { InternalInvariantError } from "@shared/error";
import type { ProjectDataSection } from "@shared/project-event";

// 结果型页面以后端写入结果确认的 project path 与 section revision 作为重建门闩。
export function create_project_section_result_refresh(args: {
  write_result: ProjectWriteResult;
  policy: ResultRefreshPolicy;
  section: ProjectDataSection;
}): PendingResultRefresh | null {
  if (!should_rebuild_result(args.policy)) {
    return null;
  }

  return create_result_refresh({
    policy: args.policy,
    source: resolve_project_section_result_source(args.write_result, args.section),
  });
}

// 同步写入改变成员或顺序时必须返回目标 section revision，否则页面无法判定哪次回灌该重建快照。
export function resolve_project_section_result_source(
  write_result: ProjectWriteResult,
  section: ProjectDataSection,
): ResultSource {
  const section_sources = write_result.changes.flatMap((change) => {
    if (!change.updatedSections.includes(section)) {
      return [];
    }

    const revision = change.sectionRevisions?.[section];
    return typeof revision === "number" && Number.isFinite(revision)
      ? [
          {
            projectPath: change.projectPath,
            section,
            revision,
          },
        ]
      : [];
  });

  if (section_sources.length === 0) {
    throw new InternalInvariantError({
      diagnostic_context: {
        reason: "project_section_write_missing_section_revision",
        section,
      },
    });
  }

  return section_sources.reduce((latest_source, source) => {
    return source.revision > latest_source.revision ? source : latest_source;
  });
}
