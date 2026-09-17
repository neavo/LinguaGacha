import type { WorkspaceRequest, WorkspaceRequestResult } from "./host-contract";

/** 父子进程交换 JSON 请求与状态；文本走标准流，图片请求由父进程固定内容。 */
export type AgentWorkspaceRuntimeParentMessage =
  | {
      type: "start";
      todos: string[];
      skillRoots: readonly string[]; // 带尾斜线的原目录 file: URL，含逻辑入口与真实位置
    }
  | {
      type: "response";
      id: number;
      result: { ok: true; value: WorkspaceRequestResult } | { ok: false; message: string };
    };
export type AgentWorkspaceRuntimeChildMessage =
  | { type: "request"; id: number; request: WorkspaceRequest }
  | { type: "cancel"; id: number }
  | { type: "todos"; todos: string[] };
