import type { Static } from "@earendil-works/pi-ai";
import type { WorkspaceHostRequest, WorkspaceHostResult } from "../../tools/host";
import type { WORKSPACE_IMAGE_REQUEST_SCHEMA } from "../../tools/emit-image";

export type WorkspaceRequest =
  | { kind: "resolve_proxy"; url: string }
  | Static<typeof WORKSPACE_IMAGE_REQUEST_SCHEMA>
  | WorkspaceHostRequest;
export type WorkspaceRequestResult = string | null | WorkspaceHostResult;

/** 父子进程交换 JSON 请求与状态；文本走标准流，图片请求由父进程固定内容。 */
export type AgentWorkspaceRuntimeParentMessage =
  | {
      type: "start";
      userSkillDirectory: string; // 应用级用户技能目录，直接写入并跨会话保留
      skillRoots: readonly string[]; // 带尾斜线的原目录 file: URL，含逻辑入口与真实位置
    }
  | {
      type: "response";
      id: number;
      result: { ok: true; value: WorkspaceRequestResult } | { ok: false; message: string };
    };
export type AgentWorkspaceRuntimeChildMessage =
  | { type: "request"; id: number; request: WorkspaceRequest }
  | { type: "cancel"; id: number };
