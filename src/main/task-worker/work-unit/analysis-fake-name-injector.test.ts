import { describe, expect, it } from "vitest";

import { AnalysisFakeNameInjector } from "./analysis-fake-name-injector";

describe("AnalysisFakeNameInjector", () => {
  it("为控制码注入稳定伪名并在候选入池前还原", () => {
    const injector = new AnalysisFakeNameInjector(["\\n[7]", "\\N[9]"]);

    const injected = injector.inject_texts(["\\n[7]", "\\N[9]"]);

    expect(injected[0]).toBe("蓝霁云");
    expect(injected[1]).toBe("檀秋萦");
    expect(injector.restore_glossary_entry(injected[0] ?? "", "任意译文")).toEqual([
      "\\n[7]",
      "\\n[7]",
    ]);
  });

  it("只允许纯控制码自映射通过", () => {
    expect(AnalysisFakeNameInjector.is_control_code_self_mapping("\\n[7]", "\\n[7]")).toBe(true);
    expect(AnalysisFakeNameInjector.is_control_code_self_mapping("前缀\\n[7]", "前缀\\n[7]")).toBe(
      false,
    );
  });
});
