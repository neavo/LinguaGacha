import { describe, expect, it } from "vitest";
import { read_translation_worker_result } from "./work-unit-result";

describe("翻译 worker 结果边界", () => {
  const result = {
    unit_id: "unit",
    kind: "translation",
    outcome: "success",
    metrics: { input_tokens: 1, reasoning_tokens: 0, output_tokens: 2 },
    output: { kind: "translation", items: [{ item_id: 1, dst: "译文", status: "PROCESSED" }] },
    logs: [],
  };
  it("接受跨线程完整结果并保留译文与用量", () => {
    expect(read_translation_worker_result(structuredClone(result))).toEqual(result);
  });
  it.each([
    null,
    {},
    { ...result, output: { kind: "translation", items: [null] } },
    { ...result, metrics: { input_tokens: Infinity, reasoning_tokens: 0, output_tokens: 2 } },
    { ...result, logs: [{ level: "info", content: { kind: "text", text: "bad result" } }] },
  ])("拒绝非法结果 %j", (value) => {
    expect(() => read_translation_worker_result(value)).toThrowError(
      expect.objectContaining({ code: "worker.execution_failed" }),
    );
  });
});
