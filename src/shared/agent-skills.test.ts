import { describe, expect, it } from "vitest";
import { validate_agent_skill_document } from "./agent-skills";

describe("技能字段校验", () => {
  it("名称遵循加载器协议，错误定位到名称字段", () => {
    const value = { name: "sample-2", description: "description", body: "" };
    expect(validate_agent_skill_document(value)).toBeNull();
    for (const name of ["", "Uppercase", "two--parts", "-prefix", "suffix-", "a".repeat(65)]) {
      expect(validate_agent_skill_document({ ...value, name })).toBe("name");
    }
  });
  it("描述必填且保持单行，正文可以为空", () => {
    const value = { name: "sample", description: "description", body: "" };
    for (const description of [" ", "two\nlines", "two\rlines", "a".repeat(1025)]) {
      expect(validate_agent_skill_document({ ...value, description })).toBe("description");
    }
  });
});
