/** 同一应用构建的父子进程通过 Node IPC 复制应用状态；执行结果由进程退出和标准流表达。 */
export type AgentWorkspaceRuntimeParentMessage =
  | { type: "start"; todos: string[] }
  | {
      type: "proxy_result";
      id: number;
      result: { ok: true; rules: string } | { ok: false; message: string };
    };

export type AgentWorkspaceRuntimeChildMessage =
  | { type: "proxy_request"; id: number; url: string }
  | { type: "proxy_cancel"; id: number }
  | { type: "todos"; todos: string[] };
