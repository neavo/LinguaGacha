import path from "node:path";
import { randomUUID } from "node:crypto";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import type { ImageTextHost } from "../../../shared/image-text";
import {
  IMAGE_BOX_SCHEMA,
  IMAGE_COLOR_SCHEMA,
  IMAGE_DIRECTION_SCHEMA,
  IMAGE_ID_SCHEMA,
  IMAGE_PAGE_MAX_PIXELS,
} from "../../../shared/image-package";
import type { NativeFs } from "../../../native/native-fs";
import { AGENT_WORKSPACE_WORK_ROOT } from "../workspace/runtime/policy";

const REQUEST = Type.Object(
  {
    kind: Type.Literal("render_image_text_page"),
    page: Type.Object(
      {
        pageId: IMAGE_ID_SCHEMA,
        regions: Type.Array(
          Type.Object(
            {
              regionId: IMAGE_ID_SCHEMA,
              box: IMAGE_BOX_SCHEMA,
              direction: IMAGE_DIRECTION_SCHEMA,
              backgroundColor: IMAGE_COLOR_SCHEMA,
              text: Type.String(),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: 10000 },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type WorkspaceRenderImageTextRequest = Static<typeof REQUEST>;
export type WorkspaceRenderImageTextResult = { path: string };
export type WorkspaceRenderImageTextPort = (
  request: WorkspaceRenderImageTextRequest,
  signal: AbortSignal,
) => Promise<WorkspaceRenderImageTextResult>;

/** 绘字窗口由宿主收尾，位图通过工作区临时文件交接。 */
export function create_image_text_renderer(options: {
  root: string;
  nativeFs: NativeFs;
  host: ImageTextHost;
}): WorkspaceRenderImageTextPort {
  return async (request, signal) => {
    signal.throwIfAborted();
    const paint = await options.host(request, signal);
    signal.throwIfAborted(); // 停止后不再写入字层。
    const output = path.resolve(options.root, AGENT_WORKSPACE_WORK_ROOT, `${randomUUID()}.json`);
    options.nativeFs.write_file_atomic(output, JSON.stringify(paint));
    return { path: output };
  };
}

/** 在工作区与 Electron 宿主之间校验绘字数据。 */
export async function execute_render_image_text_request(
  request: unknown,
  signal: AbortSignal,
  render: WorkspaceRenderImageTextPort | undefined,
): Promise<WorkspaceRenderImageTextResult> {
  if (
    !Check(REQUEST, request) ||
    request.page.regions.some(
      ({ box: [, , width, height] }) => width * height > IMAGE_PAGE_MAX_PIXELS,
    )
  )
    throw new Error("Invalid workspace render_image_text_page request.");
  if (!render) throw new Error("Image text renderer unavailable.");
  return render(request, signal);
}
