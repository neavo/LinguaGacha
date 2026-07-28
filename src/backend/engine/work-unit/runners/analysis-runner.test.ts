import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalysisWorkUnitRunner } from "./analysis-runner";
import type { LLMClientPort, LLMRequestBody } from "../../../llm/llm-types";
import type { AnalysisWorkUnit } from "../../protocol/work-unit";

const cleanup_roots: string[] = [];

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
  afterEach(async () => {
    while (cleanup_roots.length > 0) {
      await rm(cleanup_roots.pop()!, { force: true, recursive: true });
    }
  });

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

  it("归一模型术语候选并按语义分段记录日志", async () => {
    const captured_requests: LLMRequestBody[] = [];
    const runner = new AnalysisWorkUnitRunner(await create_template_root(), {
      request: async (body) => {
        captured_requests.push(body);
        return {
          response_think: "分析思考链",
          response_result:
            '<why>[难点处理]：Alice -> 女性人名</why>\n{"src":"Alice","dst":"爱丽丝","type":"女性人名"}',
          input_tokens: 2,
          output_tokens: 3,
          cancelled: false,
          timeout: false,
          degraded: false,
        };
      },
    });

    const result = await runner.execute_unit(
      {
        kind: "analysis",
        unit_id: "analysis-unit-1",
        run_id: "run-1",
        model: {},
        config_snapshot: {
          app_language: "ZH",
          source_language: "EN",
          target_language: "ZH",
        },
        quality_snapshot: {},
        payload: {
          file_path: "demo.txt",
          items: [{ item_id: 1, file_path: "demo.txt", src_text: "【虎鉄】Alice" }],
        },
        diagnostics: { retry_count: 0 },
      },
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      outcome: "success",
      metrics: { input_tokens: 2, output_tokens: 3 },
      output: {
        kind: "analysis",
        glossary_entries: [
          { src: "Alice", dst: "爱丽丝", info: "女性人名", case_sensitive: false },
        ],
      },
    });
    expect(captured_requests[0]?.messages[1]?.content).toContain("【虎鉄】Alice");
    const message = String(result.logs[0]?.message ?? "");
    expect(message.indexOf("思考过程：")).toBeLessThan(message.indexOf("规则分析："));
    expect(message.indexOf("规则分析：")).toBeLessThan(message.indexOf("分析输入："));
    expect(message.indexOf("分析输入：")).toBeLessThan(message.indexOf("分析结果："));
    expect(message).toContain("TERM: Alice -> 爱丽丝 #女性人名");
  });
});

async function create_template_root(): Promise<string> {
  const app_root = await mkdtemp(path.join(tmpdir(), "linguagacha-analysis-runner-"));
  cleanup_roots.push(app_root);
  const dir = path.join(app_root, "resource", "analysis_prompt", "template", "zh");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "prefix.txt"), "前缀", "utf-8");
  await writeFile(path.join(dir, "base.txt"), "提取 {target_language} 术语", "utf-8");
  await writeFile(path.join(dir, "thinking.txt"), "", "utf-8");
  await writeFile(path.join(dir, "suffix.txt"), "输出 JSONLINE", "utf-8");
  return app_root;
}
