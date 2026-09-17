import { Type, type Static } from "@earendil-works/pi-ai";

/** 只暴露 Node 缺少的宿主原语；领域流程由技能中的普通模块组合。 */
export const WORKSPACE_HOST_REQUEST_SCHEMA = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("print_pdf"),
      html: Type.String({ description: "静态 HTML；宿主禁止脚本和外部资源" }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("export_pdf"),
      file_path: Type.String({ minLength: 1 }),
      fp: Type.String({
        minLength: 1,
        description: "project_meta.files 中待导出 PDF 的当前 pdf_fp",
      }),
    },
    { additionalProperties: false },
  ),
]);
export type WorkspaceHostRequest = Static<typeof WORKSPACE_HOST_REQUEST_SCHEMA>;
export type WorkspaceHostResult = { path: string } | { output_path: string };
export type WorkspaceHostPort = (
  request: WorkspaceHostRequest,
  signal: AbortSignal,
) => Promise<WorkspaceHostResult>;
export type WorkspaceRequest =
  | { kind: "resolve_proxy"; url: string }
  | { kind: "emit_image"; path: string }
  | WorkspaceHostRequest;
export type WorkspaceRequestResult = string | null | WorkspaceHostResult;
