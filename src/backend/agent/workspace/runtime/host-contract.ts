import { Type, type Static } from "@earendil-works/pi-ai";
import { AGENT_IMAGE_DEFAULT_MAX_EDGE, AGENT_IMAGE_MAX_EDGE } from "../../../../shared/agent-image";

/** 图片选项的运行时校验和模型声明共用此 Schema。 */
export const WORKSPACE_IMAGE_OPTIONS_SCHEMA = Type.Object(
  {
    maxEdge: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: AGENT_IMAGE_MAX_EDGE,
        description: `图片最长边上限，默认 ${AGENT_IMAGE_DEFAULT_MAX_EDGE} 像素。保持比例，仅缩小超限图片。字节额度可能使实际尺寸更小。`,
      }),
    ),
  },
  { additionalProperties: false },
);
/** 父进程在读取工作区文件前校验完整图片请求。 */
export const WORKSPACE_IMAGE_REQUEST_SCHEMA = Type.Object(
  {
    kind: Type.Literal("emit_image"),
    path: Type.String({ minLength: 1 }),
    options: Type.Optional(WORKSPACE_IMAGE_OPTIONS_SCHEMA),
  },
  { additionalProperties: false },
);

/** 只暴露 Node 缺少的宿主原语；领域流程由技能中的普通模块组合。 */
export const WORKSPACE_HOST_REQUEST_SCHEMA = Type.Object(
  {
    kind: Type.Literal("print_pdf"),
    html: Type.String({ description: "静态 HTML；宿主禁止脚本和外部资源" }),
  },
  { additionalProperties: false },
);
export type WorkspaceHostRequest = Static<typeof WORKSPACE_HOST_REQUEST_SCHEMA>;
export type WorkspaceHostResult = { path: string };
export type WorkspaceHostPort = (
  request: WorkspaceHostRequest,
  signal: AbortSignal,
) => Promise<WorkspaceHostResult>;
export type WorkspaceRequest =
  | { kind: "resolve_proxy"; url: string }
  | Static<typeof WORKSPACE_IMAGE_REQUEST_SCHEMA>
  | WorkspaceHostRequest;
export type WorkspaceRequestResult = string | null | WorkspaceHostResult;
