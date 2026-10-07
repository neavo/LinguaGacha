import { agent_tool_call } from "../../../test/agent-tool-fixture";
import { describe, expect, it, vi } from "vitest";
import { workspace_execution } from "../../../test/agent-workspace-fixture";
import { create_agent_workspace_run_tool } from "./workspace-run";
import { AgentToolError } from "../tool-definition";
import type { AgentWorkspacePort } from "../workspace/service";

describe("workspace_run", () => {
  it("工作区图片作为 SDK image content 返回，摘要不包含图片字节", async () => {
    const run = vi.fn(async () => ({
      execution: workspace_execution(),
      images: [
        {
          path: "work/image.webp",
          image: {
            mimeType: "image/webp" as const,
            data: "aW1hZ2U=",
            width: 100,
            height: 50,
            originalWidth: 100,
            originalHeight: 50,
          },
        },
      ],
    }));
    const tool = create_tool(run);
    const result = await tool.execute(
      { script: "await ws.emitImage('work/image.webp');" },
      ...agent_tool_call("image"),
    );
    expect(result.content).toContainEqual({
      type: "image",
      mimeType: "image/webp",
      data: "aW1hZ2U=",
    });
    expect(result.details).toMatchObject({
      images: [
        {
          path: "work/image.webp",
          mime_type: "image/webp",
          width: 100,
          height: 50,
          original_width: 100,
          original_height: 50,
        },
      ],
    });
    expect(JSON.stringify(result.details)).not.toContain("aW1hZ2U=");
  });
  it("调用期间停止仍保留实际成功的执行结果", async () => {
    const released = Promise.withResolvers<void>();
    const run = vi.fn(async () => {
      await released.promise;
      return { images: [], execution: workspace_execution() };
    });
    const script_tool = create_tool(run);
    const controller = new AbortController();
    const reason = new Error("停止任务");

    const result = script_tool.execute(
      { script: "console.log(null);" },
      ...agent_tool_call("script", controller.signal),
    );
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    controller.abort(reason);
    released.resolve();

    await expect(result).resolves.toMatchObject({ details: workspace_execution() });
  });
  it("脚本和刷新同时失败保留主回执与两个原始原因", async () => {
    const script_error = new AgentToolError({ code: "script_failed", scriptPath: "work/run.mjs" });
    const refresh_error = new Error("刷新失败");
    const tool = create_agent_workspace_run_tool({
      run: async () => {
        throw script_error;
      },
      refresh_skills: async () => {
        throw refresh_error;
      },
    });
    const error = await tool
      .execute({ script: "throw 1;" }, ...agent_tool_call("failed"))
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AgentToolError);
    expect(error).toMatchObject({
      details: script_error.details,
      cause: { errors: [script_error, refresh_error] },
    });
  });

  it("脚本取消后刷新失败仍报告真实刷新故障", async () => {
    const controller = new AbortController();
    const tool = create_agent_workspace_run_tool({
      run: async () => {
        controller.abort();
        throw controller.signal.reason;
      },
      refresh_skills: async () => {
        throw new Error("刷新失败");
      },
    });
    await expect(
      tool.execute({ script: "等待" }, ...agent_tool_call("stopped", controller.signal)),
    ).rejects.toMatchObject({
      details: { code: "tool_failed" },
      cause: { name: "AggregateError" },
    });
  });
});
/** 注入工作区执行端口，刷新结果由会话集成测试验证。 */
function create_tool(run: AgentWorkspacePort["run"]) {
  return create_agent_workspace_run_tool({
    run,
    refresh_skills: async () => {},
  });
}
