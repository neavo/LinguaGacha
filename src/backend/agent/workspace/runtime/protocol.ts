import type { WorkspaceRequest, WorkspaceRequestResult } from "./host-contract";

/** 父子进程交换 JSON 请求与状态；文本走标准流，图片请求由父进程固定内容。 */
export type AgentWorkspaceRuntimeParentMessage =
  | { type: "start"; todos: string[] }
  | {
      type: "response";
      id: number;
      result: { ok: true; value: WorkspaceRequestResult } | { ok: false; message: string };
    };
export type AgentWorkspaceRuntimeChildMessage =
  | { type: "request"; id: number; request: WorkspaceRequest }
  | { type: "cancel"; id: number }
  | { type: "todos"; todos: string[] };
