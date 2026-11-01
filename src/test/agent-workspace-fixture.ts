import type { AgentProcessOutputContent } from "../backend/agent/process-output";
import fs from "node:fs";
import path from "node:path";
import type {
  AgentWorkspaceExecution,
  AgentWorkspaceOutput,
} from "../backend/agent/workspace/runtime/runner";

/** 应用侧测试只隔离进程执行；执行记录仍遵循真实公开形状。 */
export function workspace_execution(
  stdout: AgentProcessOutputContent = "",
  stderr: AgentProcessOutputContent = "",
): AgentWorkspaceExecution {
  return {
    scriptPath: "work/runs/test.mjs",
    exitCode: 0,
    signal: null,
    stdout: output_file(stdout, "work/runs/test.stdout.log"),
    stderr: output_file(stderr, "work/runs/test.stderr.log"),
  };
}

/** 假执行结果同样区分日志原文字节数与返回的结构化内容。 */
function output_file(content: AgentProcessOutputContent, path: string): AgentWorkspaceOutput {
  return {
    path,
    bytes: Buffer.byteLength(typeof content === "string" ? content : JSON.stringify(content)),
    content,
  };
}

/** 宿主启动测试使用最小部署目录，只验证组合根生命周期。 */
export function create_workspace_runtime_fixture(root: string): string {
  const directory = path.join(root, "runtime");
  fs.mkdirSync(path.join(directory, "node_modules"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies: {} }),
  );
  return directory;
}
