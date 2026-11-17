import type {
  WorkspaceGenerateFilesRequest,
  WorkspaceGetOutputPathsRequest,
} from "../../tools/generate-files";
import type { WorkspaceGenerateImageQARequest } from "../../tools/generate-image-qa";
import type { ImageQualityResult } from "../../../../shared/image";
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
import type { InferenceConfiguration } from "../../inference/runtime";
import type { WorkspaceSearchRequest, SearchResponse } from "../../search/schema";
import type { AppErrorCode, AppErrorPublicDetails } from "../../../../shared/error";

export type WorkspaceOperations = {
  search: { request: WorkspaceSearchRequest; response: SearchResponse };
  resolve_proxy: { request: { kind: "resolve_proxy"; url: string }; response: string };
  resolve_package_source: {
    request: { kind: "resolve_package_source" }; // 对话身份由宿主绑定，子进程不携带
    response: "official" | "mirror";
  };
  emit_image: { request: Static<typeof WORKSPACE_IMAGE_REQUEST_SCHEMA>; response: null };
  doing: { request: Static<typeof WORKSPACE_DOING_REQUEST_SCHEMA>; response: null };
  print_pdf: { request: WorkspacePrintPDFRequest; response: WorkspacePrintPDFResult };
  inspect_sources: { request: WorkspaceInspectSourcesRequest; response: SourceInspection[] };
  generate_image_qa: {
    request: WorkspaceGenerateImageQARequest;
    response: ImageQualityResult;
  };
  generate_files: {
    request: WorkspaceGenerateFilesRequest;
    response: TranslationFileGenerationResult;
  };
  get_output_paths: {
    request: WorkspaceGetOutputPathsRequest;
    response: TranslationOutputPaths;
  };
};
export type WorkspaceOperation = keyof WorkspaceOperations;
export type WorkspaceRequest<K extends WorkspaceOperation = WorkspaceOperation> =
  WorkspaceOperations[K]["request"];
export type WorkspaceResponse<K extends WorkspaceOperation = WorkspaceOperation> =
  WorkspaceOperations[K]["response"];
export type WorkspaceResponseFor<R extends WorkspaceRequest> =
  WorkspaceOperations[R["kind"]]["response"];
export type WorkspaceError = {
  code: AppErrorCode;
  message: string;
  public_details?: AppErrorPublicDetails;
};

/** 父子进程通过 IPC 交换 JSON 请求与状态。文本走标准流，图片内容由父进程固定。 */
export type AgentWorkspaceRuntimeParentMessage =
  | {
      type: "start";
      userSkillDirectory: string; // 应用级用户技能目录，直接写入并跨会话保留
      fontsDirectory: string; // 应用随附字体目录，只读
      nodeRoot: string;
      runtimeDirectory: string; // 当前应用规范化的运行目录，应用 SDK 不依赖用户安装树
      moduleRoots: readonly string[]; // 带尾斜线的原目录 file: URL，含逻辑入口与真实位置
      uv: UvConfiguration;
      inference: InferenceConfiguration;
    }
  | {
      type: "response";
      id: number;
      result: { ok: true; value: WorkspaceResponse } | { ok: false; error: WorkspaceError };
    };
export type AgentWorkspaceRuntimeChildMessage =
  | { type: "request"; id: number; request: WorkspaceRequest }
  | { type: "cancel"; id: number };

/** runner 只给根进程设置的环境标记，bootstrap 据此区分根进程与脚本自行创建的后代。 */
export const AGENT_WORKSPACE_ENTRY_ENV = "LG_WORKSPACE_ENTRY";
