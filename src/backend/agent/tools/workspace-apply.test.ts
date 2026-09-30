import { describe, expect, it, vi } from "vitest";
import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { create_agent_workspace_apply_tool } from "./workspace-apply";
import type { AgentWorkspacePort } from "../workspace/service";

describe("workspace_apply", () => {
  it("自动提交并返回服务回执，拒绝额外参数", async () => {
    const result = { status: "applied", changes: { items: { updated: 2 } } };
    const apply_workspace = vi.fn<AgentWorkspacePort["apply_workspace"]>(async () => result);
    const tool = create_agent_workspace_apply_tool({
      workspace: { apply_workspace },
      approval: { read_mode: () => "auto", wait_for_decision: vi.fn() },
    });
    expect(() =>
      validateToolArguments(tool, {
        type: "toolCall",
        id: "apply",
        name: tool.name,
        arguments: { target: "items" },
      } as ToolCall),
    ).toThrow();
    expect((await tool.execute("apply", {}, undefined, undefined, {} as never)).details).toEqual(
      result,
    );
    expect(apply_workspace).toHaveBeenCalledWith(undefined);
  });
});
