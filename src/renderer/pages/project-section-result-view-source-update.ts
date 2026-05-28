import type { ProjectMutationResult } from "@/app/desktop/desktop-project-mutation";
import {
  create_result_view_source_update_request,
  should_rebuild_result_view_source,
  type ResultViewSourceUpdatePolicy,
  type ResultViewSourceUpdateRequest,
  type ResultViewSourceUpdateSource,
} from "@/pages/result-view-snapshot";
import { InternalInvariantError } from "@shared/error";
import type { ProjectDataSection } from "@shared/project-event";

// 结果型页面以后端 mutation result 确认的 project path 与 section revision 作为重建门闩。
export function create_project_section_result_view_source_update_request(args: {
  mutation_result: ProjectMutationResult;
  policy: ResultViewSourceUpdatePolicy;
  section: ProjectDataSection;
}): ResultViewSourceUpdateRequest | null {
  if (!should_rebuild_result_view_source(args.policy)) {
    return null;
  }

  return create_result_view_source_update_request({
    policy: args.policy,
    source: resolve_project_section_mutation_source(args.mutation_result, args.section),
  });
}

// 同步 mutation 改变成员或顺序时必须返回目标 section revision，否则页面无法判定哪次回灌该重建快照。
export function resolve_project_section_mutation_source(
  mutation_result: ProjectMutationResult,
  section: ProjectDataSection,
): ResultViewSourceUpdateSource {
  const section_sources = mutation_result.changes.flatMap((change) => {
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
        reason: "project_section_mutation_missing_section_revision",
        section,
      },
    });
  }

  return section_sources.reduce((latest_source, source) => {
    return source.revision > latest_source.revision ? source : latest_source;
  });
}
