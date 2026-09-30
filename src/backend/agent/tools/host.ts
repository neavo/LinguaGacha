import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NativeFs } from "../../../native/native-fs";
import type { PDFHost } from "../../../shared/pdf";
import { Check } from "typebox/value";
import { create_schema_renderer } from "../workspace/schema-description";
import type { AgentWorkspaceRequestChannel } from "../workspace/runtime/request-channel";
import { Type, type Static } from "@earendil-works/pi-ai";
/** 宿主提供 Node 缺少的基础能力。技能模块组合领域流程。 */
export const WORKSPACE_HOST_REQUEST_SCHEMA = Type.Object(
  {
    kind: Type.Literal("print_pdf"),
    html: Type.String({ description: "静态 HTML，宿主禁止脚本和外部资源。" }),
  },
  { additionalProperties: false },
);
export type WorkspaceHostRequest = Static<typeof WORKSPACE_HOST_REQUEST_SCHEMA>;
const WORKSPACE_HOST_RESULT_SCHEMA = Type.Object(
  { path: Type.String() },
  { additionalProperties: false },
);
export type WorkspaceHostResult = Static<typeof WORKSPACE_HOST_RESULT_SCHEMA>;
export type WorkspaceHostPort = (
  request: WorkspaceHostRequest,
  signal: AbortSignal,
) => Promise<WorkspaceHostResult>;

/** 宿主补齐 HTML 打印，PDF 计算在工作区进程中执行。 */
export function create_workspace_host(options: {
  root: string;
  nativeFs: NativeFs;
  pdfHost?: PDFHost | undefined;
}): WorkspaceHostPort {
  return async (request, signal) => {
    signal.throwIfAborted();
    if (!options.pdfHost) throw new Error("PDF host unavailable.");
    const bytes = await options.pdfHost({ kind: "print_pdf", html: request.html }, signal);
    // 宿主可能在取消后才完成打印，落盘前再次检查，避免停止后产生新工作文件。
    signal.throwIfAborted();
    const output = `work/${randomUUID()}.pdf`;
    await options.nativeFs.write_file(path.join(options.root, output), bytes);
    return { path: output };
  };
}

/** 参数和结果声明直接使用宿主数据契约。 */
export function describe_host(): string {
  const { render } = create_schema_renderer(new Map());
  return `host(request: ${render(WORKSPACE_HOST_REQUEST_SCHEMA)}, signal?: AbortSignal): Promise<${render(WORKSPACE_HOST_RESULT_SCHEMA)}>;`;
}
/** 通道返回联合结果，绑定处收窄宿主回执。 */
export function bind_host(channel: Pick<AgentWorkspaceRequestChannel, "call">) {
  return async (
    request: WorkspaceHostRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceHostResult> => {
    const result = await channel.call(request, signal);
    if (typeof result === "string" || result === null) throw new Error("Invalid host response.");
    return result;
  };
}

/** 父进程在工具入口校验脚本提供的宿主请求。 */
export async function execute_host_request(
  request: unknown,
  signal: AbortSignal,
  host: WorkspaceHostPort | undefined,
) {
  if (!Check(WORKSPACE_HOST_REQUEST_SCHEMA, request))
    throw new Error("Invalid workspace host request.");
  if (!host) throw new Error("Workspace host unavailable.");
  return await host(request, signal);
}
