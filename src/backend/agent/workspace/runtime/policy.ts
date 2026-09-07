/** 当前对话的工作材料目录，跨快照刷新和提交保留。 */
export const AGENT_WORKSPACE_WORK_ROOT = "work";

/** Deno 启动参数、模型说明与工具限制共同消费的 Workspace Runtime 权威。 */
export const AGENT_WORKSPACE_RUNTIME_POLICY = Object.freeze({
  timeoutMs: 120_000,
  resultBytes: 128 * 1024,
  queryPageDefault: 20,
  queryPageMax: 100,
  writeRoots: Object.freeze(["changes", AGENT_WORKSPACE_WORK_ROOT] as const),
  denoArgs: Object.freeze([
    "--no-npm",
    "--no-remote",
    "--deny-import",
    "--deny-env",
    "--deny-sys",
    "--deny-run",
    "--deny-ffi",
    "--allow-net",
  ] as const),
});
