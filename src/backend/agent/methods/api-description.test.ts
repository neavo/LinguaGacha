import { describe, expect, it } from "vitest";

import {
  format_agent_workspace_method_routes,
  format_agent_workspace_typescript_api,
} from "./api-description";
import { AGENT_WORKSPACE_RUNTIME_METHODS } from "./registry";

describe("Agent Workspace 方法说明投影", () => {
  it("TypeScript API 与领域方法注册表保持同一名称集合", () => {
    const api = format_agent_workspace_typescript_api();
    const method_names = [...api.matchAll(/^ {2}([A-Za-z_$][A-Za-z0-9_$]*)\(args:/gmu)].map(
      (match) => match[1],
    );

    expect(new Set(method_names)).toEqual(new Set(Object.keys(AGENT_WORKSPACE_RUNTIME_METHODS)));
  });

  it("System 能力路由为每个注册方法生成唯一入口", () => {
    const routes = format_agent_workspace_method_routes().split("\n");
    const method_names = routes.map((route) => route.match(/`workspace\.([^`]+)`$/u)?.[1]);

    expect(method_names).toEqual(Object.keys(AGENT_WORKSPACE_RUNTIME_METHODS));
    expect(new Set(method_names).size).toBe(method_names.length);
  });
});
