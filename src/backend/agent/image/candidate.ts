import path from "node:path";
import type { ErasePageResult, RunRecord } from "./state";

/** 按运行中的区域顺序归一的选择，供提交与幂等重放使用。 */
export type CandidateDecision = {
  pageId: string;
  regions: { regionId: string; value: string }[];
};

/** 产品 Agent 必须完整选择本次运行的候选，错误输入不能静默降级为修复失败。 */
export function read_candidate_decisions(
  pages: readonly ErasePageResult[],
  input: readonly CandidateDecision[],
): CandidateDecision[] {
  const pageInputs = new Map<string, CandidateDecision>();
  for (const decision of input) {
    const page = pages.find((item) => item.pageId === decision.pageId);
    if (!page || page.regions.length === 0 || pageInputs.has(decision.pageId))
      throw new Error(`Invalid or duplicate page decision: ${decision.pageId}`);
    pageInputs.set(decision.pageId, decision);
  }
  return pages.map((page) => {
    if (page.regions.length === 0) return { pageId: page.pageId, regions: [] };
    const inputPage = pageInputs.get(page.pageId);
    if (!inputPage) throw new Error(`Missing page decision: ${page.pageId}`);
    const choices = new Map<string, string>();
    for (const choice of inputPage.regions) {
      const region = page.regions.find((item) => item.regionId === choice.regionId);
      if (!region || choices.has(choice.regionId))
        throw new Error(`Invalid or duplicate region decision: ${page.pageId}/${choice.regionId}`);
      if (
        choice.value !== "preserve" &&
        choice.value !== "failed" &&
        !region.candidates.some((candidate) => candidate.candidateId === choice.value)
      )
        throw new Error(`Invalid candidate decision: ${page.pageId}/${choice.regionId}`);
      choices.set(choice.regionId, choice.value);
    }
    return {
      pageId: page.pageId,
      regions: page.regions.map((region) => {
        const value = choices.get(region.regionId);
        if (!value) throw new Error(`Missing region decision: ${page.pageId}/${region.regionId}`);
        return { regionId: region.regionId, value };
      }),
    };
  });
}

/** 校验运行身份、唯一性与候选资产目录。 */
export function validate_candidate_run(directory: string, runId: string, run: RunRecord): void {
  if (run.runId !== runId || !Array.isArray(run.pages))
    throw new Error("Erase run identity mismatch");
  const member = (value: string) => {
    const file = path.resolve(directory, value);
    const relative = path.relative(directory, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Invalid erase run member");
  };
  const pageIds = new Set<string>();
  for (const page of run.pages) {
    if (pageIds.has(page.pageId)) throw new Error("Duplicate erase run page");
    pageIds.add(page.pageId);
    const regionIds = new Set<string>();
    for (const region of page.regions) {
      if (regionIds.has(region.regionId)) throw new Error("Duplicate erase run region");
      regionIds.add(region.regionId);
      const candidateIds = new Set<string>();
      for (const candidate of region.candidates) {
        if (candidateIds.has(candidate.candidateId)) throw new Error("Duplicate erase candidate");
        candidateIds.add(candidate.candidateId);
        member(candidate.crop);
        member(candidate.eraseMask);
      }
    }
  }
}
