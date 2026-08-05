import { describe, expect, it } from "vitest";

import { RevisionConflictError } from "../../shared/error/errors/data-errors";
import { AgentToolError, normalize_agent_tool_error } from "./agent-tool-error";

describe("AgentToolError", () => {
  it("保留 Agent 工具错误并把受控应用错误投影为模型可修复事实", () => {
    const tool_error = new AgentToolError({
      code: "quality_rule.invalid_change",
      path: "write[0]",
    });
    expect(normalize_agent_tool_error(tool_error)).toBe(tool_error);

    const revision_error = normalize_agent_tool_error(
      new RevisionConflictError({
        public_details: { section: "quality", expected_revision: 2, current_revision: 3 },
      }),
    );
    expect(revision_error.details).toEqual({
      code: "data.revision_conflict",
      section: "quality",
      expected_revision: 2,
      current_revision: 3,
    });
    expect(JSON.parse(revision_error.message)).toEqual(revision_error.details);
  });

  it("未知错误保留简短消息且不暴露堆栈", () => {
    const error = normalize_agent_tool_error(new Error("写入失败"));

    expect(error.details).toEqual({ code: "tool_failed", message: "写入失败" });
    expect(error.message).not.toContain("stack");
  });
});
