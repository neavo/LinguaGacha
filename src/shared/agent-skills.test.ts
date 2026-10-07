import { describe, expect, it } from "vitest";
import { validate_agent_skill_document } from "./agent-skills";

describe("技能字段校验", () => {
  it("名称遵循加载器协议，错误定位到名称字段", () => {
    const value = { name: "sample-2", description: "description", body: "" };
    expect(validate_agent_skill_document(value)).toBeNull();
    expect(
      validate_agent_skill_document({
        name: "中文 Upper_case 💡",
        description: "two\nlines".repeat(1025),
      }),
    ).toBeNull();
    expect(
      validate_agent_skill_document({ name: "💡".repeat(64), description: "valid" }),
    ).toBeNull();
    expect(validate_agent_skill_document({ name: "💡".repeat(65), description: "valid" })).toBe(
      "name",
    );
    for (const name of ["", " "]) {
      expect(validate_agent_skill_document({ ...value, name })).toBe("name");
    }
  });
  it("描述必填，规范化空白且不限制长度，正文可以为空", () => {
    const value = { name: "sample", description: "description", body: "" };
    for (const description of [" \n\t"]) {
      expect(validate_agent_skill_document({ ...value, description })).toBe("description");
    }
  });
});
