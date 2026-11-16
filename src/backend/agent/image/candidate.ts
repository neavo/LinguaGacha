import path from "node:path";
import { default_native_fs as fs } from "../../../native/native-fs";
import { LLM_REQUEST_MAX_BYTES } from "../../llm/llm-request";
import type { ErasePageResult, RunRecord } from "./state";

/** 按运行中的区域顺序归一的选择，供提交与幂等重放使用。 */
export type CandidateDecision = {
  pageId: string;
  regions: { regionId: string; value: string }[];
};

/** 模型输出错误绑定到页或区域，随提交结果返回。 */
export type CandidateProtocolError = {
  pageId: string;
  regionId?: string;
  error: string;
};

/** 请求材料固定包含完整原页和本页全部候选拼图。 */
export function build_candidate_request(
  original: string,
  regions: ErasePageResult["regions"],
  materials: readonly string[],
): { request?: string; error?: "request_too_large" } {
  const legal = regions.map((region) => ({
    regionId: region.regionId,
    candidates: region.candidates.map((candidate) => candidate.candidateId),
  }));
  const prompt = [
    "Choose one repair result for every region in this manga page.",
    "Return one JSON object only. Each value must be a listed candidate ID, preserve, or failed.",
    "Use preserve only for decorative text that can intentionally remain untranslated.",
    "Use failed when the text should be translated but no candidate is acceptable or the evidence is insufficient.",
    "Dialogue, narration, and information needed to understand the page must not be preserved as decoration.",
    `Regions: ${JSON.stringify(legal)}`,
    "The first image is the complete original page. Candidate sheets label O as the original crop; O is not selectable.",
  ].join("\n");
  const content: (
    | { type: "text"; text: string }
    | { type: "image"; mime_type: "image/png"; data: string }
  )[] = [
    { type: "text", text: prompt },
    {
      type: "image",
      mime_type: "image/png",
      data: fs.read_file(original).toString("base64"),
    },
    ...materials.map((file) => ({
      type: "image" as const,
      mime_type: "image/png" as const,
      data: fs.read_file(file).toString("base64"),
    })),
  ];
  const request = JSON.stringify({ messages: [{ role: "user", content }] });
  return Buffer.byteLength(request) > LLM_REQUEST_MAX_BYTES
    ? { error: "request_too_large" }
    : { request };
}

/** 材料准备失败与模型协议错误分开；两者都让已知区域取得终态。 */
export function parse_candidate_decisions(
  pages: readonly ErasePageResult[],
  responses: ReadonlyMap<string, string>,
): { decisions: CandidateDecision[]; protocolErrors: CandidateProtocolError[] } {
  const protocolErrors: CandidateProtocolError[] = [];
  const decisions = pages.map((page) => {
    if (page.status !== "ready") {
      return {
        pageId: page.pageId,
        regions:
          page.status === "failed"
            ? page.regions.map((region) => ({ regionId: region.regionId, value: "failed" }))
            : [],
      };
    }
    let parsed: Record<string, unknown> = {};
    try {
      const value = JSON.parse(responses.get(page.pageId) ?? "");
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Response must be a JSON object");
      parsed = value as Record<string, unknown>;
    } catch (error) {
      protocolErrors.push({
        pageId: page.pageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const known = new Set(page.regions.map((region) => region.regionId));
    for (const key of Object.keys(parsed))
      if (!known.has(key))
        protocolErrors.push({ pageId: page.pageId, regionId: key, error: "unknown_region" });
    return {
      pageId: page.pageId,
      regions: page.regions.map((region) => {
        const value = parsed[region.regionId];
        const candidate = region.candidates.find((item) => item.candidateId === value);
        if (candidate) return { regionId: region.regionId, value: candidate.candidateId };
        if (value === "preserve" || value === "failed") return { regionId: region.regionId, value };
        protocolErrors.push({
          pageId: page.pageId,
          regionId: region.regionId,
          error: value === undefined ? "missing_selection" : "invalid_selection",
        });
        return { regionId: region.regionId, value: "failed" };
      }),
    };
  });
  return { decisions, protocolErrors };
}

/** 运行清单只允许引用自身目录内的候选资产。 */
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
    if (page.status === "settled" && page.regions.length)
      throw new Error("Settled page cannot carry candidates");
    const regionIds = new Set<string>();
    for (const region of page.regions) {
      if (regionIds.has(region.regionId)) throw new Error("Duplicate erase run region");
      regionIds.add(region.regionId);
      const candidateIds = new Set<string>();
      for (const candidate of region.candidates) {
        if (candidateIds.has(candidate.candidateId)) throw new Error("Duplicate erase candidate");
        candidateIds.add(candidate.candidateId);
        member(candidate.crop);
        member(candidate.mask);
      }
    }
  }
}
