/** 当前对话的工作材料目录，跨快照刷新和提交保留。 */
export const AGENT_WORKSPACE_WORK_ROOT = "work";

/** 宿主自动保存的执行文件集中于此，和 Agent 自行组织的脚本与材料分开。 */
export const AGENT_WORKSPACE_RUN_ROOT = `${AGENT_WORKSPACE_WORK_ROOT}/runs`;

/** 模型说明与执行限制共同消费的 Workspace Runtime 权威。 */
export const AGENT_WORKSPACE_RUNTIME_POLICY = Object.freeze({
  executionTimeoutMs: 600_000, // 租约、环境准备和脚本共用一个截止时间，收尾完成后才释放占用。
  inlineOutputBytes: 64 * 1024, // 每路直接返回的额度，完整输出始终保存在文件中
  imageCount: 10,
  imageOutputBytes: 20 * 1024 * 1024, // 模型图片 base64 累计额度，独立于 stdout/stderr
});
