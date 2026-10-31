import { expect, it, vi } from "vitest";
import { agent_tool_call } from "../../../test/agent-tool-fixture";
import { workspace_exec_execution } from "../../../test/agent-workspace-fixture";
import { create_agent_workspace_exec_tool } from "./workspace-exec";

it("工具传递命令与取消信号，并投影执行记录", async () => {
  const signal = new AbortController();
  const refresh_skills = vi.fn(async () => {});
  const run = vi.fn(async () => workspace_exec_execution());
  const tool = create_agent_workspace_exec_tool({ run, refresh_skills });
  const result = tool.execute(
    { command: "npm --version" },
    ...agent_tool_call("exec", signal.signal),
  );
  await expect(result).resolves.toHaveProperty("details", workspace_exec_execution());
  expect(run).toHaveBeenCalledWith("npm --version", signal.signal);
  expect(refresh_skills).toHaveBeenCalledOnce();
});
