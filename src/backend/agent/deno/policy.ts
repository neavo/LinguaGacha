/** Deno 启动参数、模型说明与工具限制共同消费的 Workspace Runtime 权威。 */
export const AGENT_WORKSPACE_RUNTIME_POLICY = Object.freeze({
  timeoutMs: 120_000,
  resultBytes: 128 * 1024,
  writeRoots: Object.freeze(["changes", "task", "scratch"] as const),
  denoRestrictionArgs: Object.freeze([
    "--no-npm",
    "--no-remote",
    "--deny-import",
    "--deny-net",
    "--deny-env",
    "--deny-sys",
    "--deny-run",
    "--deny-ffi",
  ] as const),
});
