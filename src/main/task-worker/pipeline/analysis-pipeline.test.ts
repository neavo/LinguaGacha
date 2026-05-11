import { describe, expect, it } from "vitest";

import { TextFakenameInjector } from "../../../shared/text/text-fakename-injector";
import { AnalysisPostPipeline } from "./analysis-post-pipeline";
import { AnalysisPrePipeline } from "./analysis-pre-pipeline";

describe("分析 pipeline", () => {
  it("译前注入姓名前缀并用伪名保护控制码", () => {
    const result = new AnalysisPrePipeline().process_context({
      file_path: "a.txt",
      retry_count: 0,
      items: [
        {
          item_id: 1,
          file_path: "a.txt",
          src_text: "\\n[7]こんにちは",
          first_name_src: "Alice",
        },
      ],
    });

    expect(result.prompt_srcs).toEqual(["【Alice】\\n[7]こんにちは"]);
    expect(result.request_srcs).toEqual(["【Alice】蓝霁云こんにちは"]);
  });

  it("译后还原控制码伪名并拆分复合术语", () => {
    const fake_name_injector = new TextFakenameInjector(["\\n[7]"]);
    const pipeline = new AnalysisPostPipeline(fake_name_injector);

    expect(
      pipeline.normalize_glossary_entries([
        { src: "蓝霁云", dst: "任意译文", info: "控制码" },
        { src: "桜、猫", dst: "樱、猫", info: "名词" },
      ]),
    ).toEqual([
      { src: "\\n[7]", dst: "\\n[7]", info: "控制码", case_sensitive: false },
      { src: "桜", dst: "樱", info: "名词", case_sensitive: false },
    ]);
  });
});
