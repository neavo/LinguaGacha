import { describe, expect, it } from "vitest";

import { AnalysisPrePipeline } from "./analysis-pre-pipeline";

describe("AnalysisPrePipeline", () => {
  it("消费已渲染的分析文本并用伪名保护控制码", () => {
    const result = new AnalysisPrePipeline().process_context({
      file_path: "a.txt",
      retry_count: 0,
      items: [
        {
          item_id: 1,
          file_path: "a.txt",
          src_text: "【虎鉄】\\n[7]こんにちは",
        },
      ],
    });

    expect(result.prompt_srcs).toEqual(["【虎鉄】\\n[7]こんにちは"]);
    expect(result.request_srcs).toEqual(["【虎鉄】蓝霁云こんにちは"]);
  });
});
