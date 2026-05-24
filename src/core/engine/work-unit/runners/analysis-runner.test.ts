import { describe, expect, it, vi } from "vitest";

import { AnalysisWorkUnitRunner } from "./analysis-runner";
import type { LLMClientPort } from "../../../llm/llm-types";
import type { AnalysisWorkUnit } from "../../protocol/work-unit";

/**
 * 构造无候选文本的分析 work unit，runner 应直接返回合法空结果。
 */
function create_empty_analysis_unit(): AnalysisWorkUnit {
  return {
    kind: "analysis",
    unit_id: "analysis-unit-1",
    run_id: "run-1",
    model: {},
    config_snapshot: {},
    quality_snapshot: {},
    payload: {
      file_path: "chapter.txt",
      items: [],
    },
    diagnostics: {
      retry_count: 0,
    },
  };
}

describe("AnalysisWorkUnitRunner", () => {
  it("没有可分析文本时返回合法空候选结果且不请求 LLM", async () => {
    const llm_client: LLMClientPort = {
      request: vi.fn(),
    };
    const runner = new AnalysisWorkUnitRunner(process.cwd(), llm_client);

    await expect(
      runner.execute_unit(create_empty_analysis_unit(), new AbortController().signal),
    ).resolves.toMatchObject({
      unit_id: "analysis-unit-1",
      kind: "analysis",
      outcome: "success",
      metrics: {
        input_tokens: 0,
        output_tokens: 0,
      },
      output: {
        kind: "analysis",
        glossary_entries: [],
        valid_empty_result: true,
      },
      logs: [],
    });
    expect(llm_client.request).not.toHaveBeenCalled();
  });
});
