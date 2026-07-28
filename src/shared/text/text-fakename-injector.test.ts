import { describe, expect, it } from "vitest";

import { TextFakenameInjector } from "./text-fakename-injector";

describe("TextFakenameInjector", () => {
  it("为控制码注入稳定且互异的伪名，并只还原纯控制码候选", () => {
    const source_texts = ["\\n[7]", "\\N[9]"];
    const injector = new TextFakenameInjector(source_texts);

    const injected = injector.inject_texts(source_texts);

    expect(injector.inject_texts(source_texts)).toEqual(injected);
    expect(new Set(injected).size).toBe(source_texts.length);
    expect(injected).not.toEqual(source_texts);
    expect(
      injected.map((fake_name) => injector.restore_glossary_entry(fake_name, "任意译文")),
    ).toEqual(source_texts.map((source_text) => [source_text, source_text]));
    expect(injector.restore_glossary_entry(`前缀${injected[0] ?? ""}`, "任意译文")).toBeNull();
  });

  it("只允许纯控制码自映射通过", () => {
    expect(TextFakenameInjector.is_control_code_self_mapping("\\n[7]", "\\n[7]")).toBe(true);
    expect(TextFakenameInjector.is_control_code_self_mapping("前缀\\n[7]", "前缀\\n[7]")).toBe(
      false,
    );
  });
});
