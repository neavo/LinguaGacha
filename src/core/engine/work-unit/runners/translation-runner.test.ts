import { describe, expect, it, vi } from "vitest";

import { TranslationWorkUnitRunner } from "./translation-runner";
import type { LLMClientPort } from "../../../llm/llm-types";
import type { TranslationWorkUnit } from "../../protocol/work-unit";

/**
 * 构造无条目的翻译 work unit，验证 runner 不会为无效 chunk 请求模型。
 */
function create_empty_translation_unit(): TranslationWorkUnit {
  return {
    kind: "translation",
    unit_id: "translation-unit-1",
    run_id: "run-1",
    model: {},
    config_snapshot: {},
    quality_snapshot: {},
    payload: {
      items: [],
      precedings: [],
    },
    diagnostics: {
      token_threshold: 0,
      split_count: 1,
      retry_count: 0,
      is_initial: true,
    },
  };
}

describe("TranslationWorkUnitRunner", () => {
  it("没有可翻译条目时返回 failed 空结果且不请求 LLM", async () => {
    const llm_client: LLMClientPort = {
      request: vi.fn(),
    };
    const runner = new TranslationWorkUnitRunner(process.cwd(), llm_client);

    await expect(
      runner.execute_unit(create_empty_translation_unit(), new AbortController().signal),
    ).resolves.toMatchObject({
      unit_id: "translation-unit-1",
      kind: "translation",
      outcome: "failed",
      metrics: {
        input_tokens: 0,
        output_tokens: 0,
      },
      output: {
        kind: "translation",
        items: [],
        row_count: 0,
      },
      logs: [],
    });
    expect(llm_client.request).not.toHaveBeenCalled();
  });
});
