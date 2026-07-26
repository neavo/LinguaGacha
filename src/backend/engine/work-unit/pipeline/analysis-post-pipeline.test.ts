import { describe, expect, it } from "vitest";

import { TextFakenameInjector } from "../../../../shared/text/text-fakename-injector";
import { AnalysisPostPipeline } from "./analysis-post-pipeline";

describe("AnalysisPostPipeline", () => {
  it("还原控制码伪名并拆分复合术语", () => {
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
