/** 同一应用构建的父子进程使用 Node IPC 复制消息；脚本结果保留 unknown，由 runner 校验。 */
export type AgentWorkspaceRuntimeParentMessage =
  | { type: "start"; script: string; todos: string[] }
  | {
      type: "proxy_result";
      id: number;
      result: { ok: true; rules: string } | { ok: false; message: string };
    };

export type AgentWorkspaceRuntimeChildMessage =
  | { type: "proxy_request"; id: number; url: string }
  | { type: "proxy_cancel"; id: number }
  | { type: "complete"; response: unknown };
