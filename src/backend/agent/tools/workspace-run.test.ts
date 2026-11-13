import { agent_tool_call } from "../../../test/agent-tool-fixture";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { workspace_execution } from "../../../test/agent-workspace-fixture";
import { create_agent_workspace_run_tool } from "./workspace-run";
import { AgentToolError } from "../tool-definition";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "../workspace/runtime/policy";
import { check_typescript } from "../../../test/typescript-fixture";

describe("workspace_run", () => {
  it("模型可见的来源识别声明与真实契约双向兼容，通用记录可编译", () => {
    const tool = create_tool(async () => ({ images: [], execution: workspace_execution() }));
    const declaration = [...tool.description.matchAll(/```ts\n([\s\S]*?)\n```/gu)].find((match) =>
      match[1]!.includes("type GenericItems"),
    )![1]!;
    check_typescript([
      `import type { SourceInspection } from ${JSON.stringify(path.resolve("src/shared/project-file-changes.ts").replaceAll("\\", "/"))};
      import type { queryItemContexts } from ${JSON.stringify(path.resolve("src/backend/agent/project/item-contexts.ts").replaceAll("\\", "/"))};
      ${declaration.replace("declare module '@lg/project'", "declare namespace Project")}
      const inspections: SourceInspection[] = await Project.inspectSources(['input']);
      const described: Project.SourceInspection[] = inspections;
      const realQuery: typeof queryItemContexts = Project.queryItemContexts;
      const describedQuery: typeof Project.queryItemContexts = realQuery;
      const records: GenericItems = [{ message: 'text', locator: { record: 1, private: [true, null] } }];
      // @ts-expect-error 正文必须是字符串。
      const invalid: GenericItems = [{ message: 3 }];
    `,
    ]);
  });
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
    expect(result.output).toContainEqual({
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
  it("时限采用默认值或显式秒数，校验范围后传递调用身份", async () => {
    const run = vi.fn<Parameters<typeof create_agent_workspace_run_tool>[0]["run"]>(async () => ({
      images: [],
      execution: workspace_execution(),
    }));
    const tool = create_tool(run);
    await tool.execute({ script: "1;" }, ...agent_tool_call("default"));
    await tool.execute({ script: "2;", timeout_seconds: 900 }, ...agent_tool_call("explicit"));
    expect(run.mock.calls.map(([request]) => request)).toEqual([
      {
        script: "1;",
        timeoutMs: AGENT_WORKSPACE_RUNTIME_POLICY.defaultTimeoutSeconds * 1000,
        callId: "default",
      },
      { script: "2;", timeoutMs: 900_000, callId: "explicit" },
    ]);
    const { minTimeoutSeconds, maxTimeoutSeconds } = AGENT_WORKSPACE_RUNTIME_POLICY;
    for (const timeout_seconds of [minTimeoutSeconds - 1, maxTimeoutSeconds + 1]) {
      expect(() =>
        validateToolArguments(tool, {
          type: "toolCall",
          id: "invalid",
          name: tool.name,
          arguments: { script: "1;", timeout_seconds },
        }),
      ).toThrow();
    }
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

    await expect(result).resolves.toHaveProperty("details", workspace_execution()); // 回执只含执行记录。
  });
  it("脚本成功或失败后都刷新技能，仅刷新失败时保留刷新原因", async () => {
    const script_error = new Error("脚本失败");
    const refresh_error = new Error("刷新失败");
    const refresh_skills = vi.fn(async () => {});
    const failed = create_agent_workspace_run_tool({
      run: async () => {
        throw script_error;
      },
      refresh_skills,
    });
    await expect(failed.execute({ script: "throw 1;" }, ...agent_tool_call("a"))).rejects.toBe(
      script_error,
    );
    expect(refresh_skills).toHaveBeenCalledOnce();
    const refresh_failed = create_agent_workspace_run_tool({
      run: async () => ({ images: [], execution: workspace_execution() }),
      refresh_skills: async () => {
        throw refresh_error;
      },
    });
    await expect(
      refresh_failed.execute({ script: "console.log(1);" }, ...agent_tool_call("b")),
    ).rejects.toMatchObject({ cause: refresh_error });
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
    await expect(
      tool.execute({ script: "throw 1;" }, ...agent_tool_call("failed")),
    ).rejects.toMatchObject({ cause: script_error, errors: [script_error, refresh_error] });
  });
});
/** 注入工作区执行端口，刷新结果由会话集成测试验证。 */
function create_tool(run: Parameters<typeof create_agent_workspace_run_tool>[0]["run"]) {
  return create_agent_workspace_run_tool({
    run,
    refresh_skills: async () => {},
  });
}
