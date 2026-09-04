import { describe, expect, it } from "vitest";

import {
  format_agent_workspace_tool_routes,
  format_agent_workspace_typescript_api,
} from "./api-description";
import { AGENT_WORKSPACE_DATA_TOOLS } from "./registry";

describe("Agent Workspace 工具说明投影", () => {
  it("TypeScript API 在 ws.tool 下公开完整数据工具与 HTML 工具", () => {
    const api = format_agent_workspace_typescript_api();
    const method_names = [...api.matchAll(/^ {4}([A-Za-z_$][A-Za-z0-9_$]*)\(args:/gmu)].map(
      (match) => match[1],
    );

    expect(new Set(method_names)).toEqual(new Set(Object.keys(AGENT_WORKSPACE_DATA_TOOLS)));
    expect(api).toContain("declare const ws: Readonly<{");
    expect(api).toContain("tool: Readonly<WorkspaceHtmlTools & {");
    expect(api).toContain("htmlToMarkdown(html: string");
    expect(api).toContain("streamHtmlToMarkdown(");
  });

  it("System 能力路由为每个注册数据工具生成唯一入口", () => {
    const routes = format_agent_workspace_tool_routes().split("\n");
    const method_names = routes.map((route) => route.match(/`ws\.tool\.([^`]+)`$/u)?.[1]);

    expect(method_names).toEqual(Object.keys(AGENT_WORKSPACE_DATA_TOOLS));
    expect(new Set(method_names).size).toBe(method_names.length);
  });
});
