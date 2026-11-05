import type {
  WorkspaceGenerateFilesRequest,
  WorkspaceGetOutputPathsRequest,
} from "../../tools/generate-files";
import type {
  TranslationFileGenerationResult,
  TranslationOutputPaths,
} from "../../../../shared/translation-generation";
import type { SourceInspection } from "../../../../shared/project-file-changes";
import type { WorkspaceInspectSourcesRequest } from "../../tools/inspect-sources";
import type { Static } from "@earendil-works/pi-ai";
import type { WorkspacePrintPDFRequest, WorkspacePrintPDFResult } from "../../tools/print-pdf";
import type { WORKSPACE_IMAGE_REQUEST_SCHEMA } from "../../tools/emit-image";
import type { WORKSPACE_DOING_REQUEST_SCHEMA } from "../../tools/doing";
import type { UvConfiguration } from "../../uv/types";

export type WorkspaceRequest =
  | { kind: "resolve_proxy"; url: string }
  | Static<typeof WORKSPACE_IMAGE_REQUEST_SCHEMA>
  | Static<typeof WORKSPACE_DOING_REQUEST_SCHEMA>
  | WorkspacePrintPDFRequest
  | WorkspaceInspectSourcesRequest
  | WorkspaceGenerateFilesRequest
  | WorkspaceGetOutputPathsRequest;
export type WorkspaceRequestResult =
  | string
  | null
  | WorkspacePrintPDFResult
  | SourceInspection[]
  | TranslationFileGenerationResult
  | TranslationOutputPaths;

/** 父子进程通过 IPC 交换 JSON 请求与状态。文本走标准流，图片内容由父进程固定。 */
export type AgentWorkspaceRuntimeParentMessage =
  | {
      type: "start";
      userSkillDirectory: string; // 应用级用户技能目录，直接写入并跨会话保留
      nodeRoot: string;
      runtimeDirectory: string; // 当前应用规范化的运行目录，应用 SDK 不依赖用户安装树
      moduleRoots: readonly string[]; // 带尾斜线的原目录 file: URL，含逻辑入口与真实位置
      uv: UvConfiguration;
    }
  | {
      type: "response";
      id: number;
      result: { ok: true; value: WorkspaceRequestResult } | { ok: false; message: string };
    };
export type AgentWorkspaceRuntimeChildMessage =
  | { type: "request"; id: number; request: WorkspaceRequest }
  | { type: "cancel"; id: number };

/** runner 只给根进程设置的环境标记，bootstrap 据此区分根进程与脚本自行创建的后代。 */
export const AGENT_WORKSPACE_ENTRY_ENV = "LG_WORKSPACE_ENTRY";
