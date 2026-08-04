import { describe, expect, it, vi } from "vitest";

import { ProjectSessionState } from "../project/project-session-state";
import { create_agent_project_tools } from "./agent-project-tools";

describe("Agent 工程信息工具", () => {
  it("守卫 loaded 工程后只返回规范化语言", async () => {
    const read_setting = vi.fn(() => ({
      source_language: " ja ",
      target_language: " zh ",
      api_key: "secret",
      models: [{ id: "private" }],
    }));
    const require_loaded_project_path = vi.fn(() => "E:/secret/project.lg");
    const tool = create_agent_project_tools({
      settings: { read_setting },
      sessionState: { require_loaded_project_path },
    })[0];
    if (tool === undefined) throw new Error("缺少 query_project_meta");

    expect(tool.parameters).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    const result = await tool.execute("meta", {}, undefined, undefined, undefined as never);
    expect(result.details).toEqual({ source_language: "JA", target_language: "ZH" });
    expect(result.details).not.toHaveProperty("projectPath");
    expect(result.details).not.toHaveProperty("sectionRevisions");
    expect(result.details).not.toHaveProperty("models");
    expect(result.details).not.toHaveProperty("api_key");
    expect(require_loaded_project_path).toHaveBeenCalledBefore(read_setting);
  });

  it("未加载工程时沿用 ProjectNotLoadedError 且不读取设置", async () => {
    const sessionState = new ProjectSessionState();
    const read_setting = vi.fn(() => ({}));
    const tool = create_agent_project_tools({ settings: { read_setting }, sessionState })[0];
    if (tool === undefined) throw new Error("缺少 query_project_meta");

    await expect(
      tool.execute("meta", {}, undefined, undefined, undefined as never),
    ).rejects.toThrow("project.not_loaded");
    expect(read_setting).not.toHaveBeenCalled();
  });
});
