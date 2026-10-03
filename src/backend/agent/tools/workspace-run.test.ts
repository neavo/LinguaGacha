import { agent_tool_call } from "../../../test/agent-tool-fixture";
import { describe, expect, it, vi } from "vitest";
import { workspace_execution } from "../../../test/agent-workspace-fixture";
import { create_agent_workspace_run_tool } from "./workspace-run";
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
  it("调用期间取消时拒绝迟到的执行结果", async () => {
    let release_run = (): void => undefined;
    const run_released = new Promise<void>((resolve) => {
      release_run = resolve;
    });
    const run = vi.fn(async () => {
      await run_released;
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
    release_run();

    await expect(result).rejects.toBe(reason);
  });
});
/** 注入工作区执行端口，刷新结果由会话集成测试验证。 */
function create_tool(run: AgentWorkspacePort["run"]) {
  return create_agent_workspace_run_tool({
    run,
    refresh_skills: async () => {},
    log_refresh_error: () => {},
  });
}
