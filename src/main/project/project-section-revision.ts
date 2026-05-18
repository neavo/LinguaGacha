import type { ApiJsonValue } from "../api/api-types";
import { QualityRule } from "../../base/quality";
import { Prompt } from "../../base/prompt";
import { PROJECT_DATA_SECTIONS, type ProjectDataSection } from "../../shared/project/event";

type JsonRecord = Record<string, ApiJsonValue>;

export { PROJECT_DATA_SECTIONS };
export type { ProjectDataSection };

/**
 * 统一读取项目运行态 section revision，供读取接口和同步 mutation 事件共享口径
 */
export function get_runtime_section_revision(meta: JsonRecord, section: string): number {
  if (section.startsWith("quality:")) {
    return read_revision_meta(meta[`quality_rule_revision.${section.slice("quality:".length)}`]);
  }
  if (section.startsWith("prompts:")) {
    return read_revision_meta(meta[`quality_prompt_revision.${section.slice("prompts:".length)}`]);
  }
  if (section === "quality") {
    return Math.max(
      ...QualityRule.all().map((rule) => read_revision_meta(meta[rule.revision_meta_key])),
      0,
    );
  }
  if (section === "prompts") {
    return Math.max(
      ...Prompt.all().map((prompt) => read_revision_meta(meta[prompt.revision_meta_key])),
      0,
    );
  }
  if (section === "files" || section === "items" || section === "analysis") {
    return read_revision_meta(meta[`project_runtime_revision.${section}`]);
  }
  if (section === "proofreading") {
    return read_revision_meta(meta["proofreading_revision.proofreading"]);
  }
  return 0;
}

export function build_section_revisions_from_meta(
  meta: JsonRecord,
): Record<ProjectDataSection, number> {
  // manifest 与变更事件都需要全量项目数据 section revision，任务运行态必须走 task snapshot
  return Object.fromEntries(
    PROJECT_DATA_SECTIONS.map((section) => [section, get_runtime_section_revision(meta, section)]),
  ) as Record<ProjectDataSection, number>;
}

function read_revision_meta(value: ApiJsonValue | undefined): number {
  const number_value = Number(value ?? 0);
  if (!Number.isFinite(number_value) || number_value < 0) {
    // 旧项目或坏 meta 不能把 revision 读成 NaN / 负数，否则乐观锁会失去稳定基线
    return 0;
  }
  return Math.trunc(number_value);
}
