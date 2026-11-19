import path from "node:path";
import { randomUUID } from "node:crypto";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { IMAGE_TEXT_RULES, type ImageTextHost } from "../../../shared/image-text";
import { IMAGE_TEXT_PAGE_SCHEMA } from "../../../shared/image-text-schema";
import type { NativeFs } from "../../../native/native-fs";
import { AGENT_WORKSPACE_WORK_ROOT } from "../workspace/runtime/policy";

const REQUEST = Type.Object(
  {
    kind: Type.Literal("render_image_text_page"),
    path: Type.String({ minLength: 1 }),
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
    const fs = options.nativeFs;
    const work = path.resolve(options.root, AGENT_WORKSPACE_WORK_ROOT);
    const root = fs.real_path(work);
    const file = fs.real_path(path.resolve(options.root, request.path));
    const relative = path.relative(root, file);
    if (
      !relative ||
      path.isAbsolute(relative) ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`)
    )
      throw new Error("Text layout file is outside the workspace");
    const info = fs.stat(file);
    const maximum = IMAGE_TEXT_RULES.maximumMaterialBytes;
    if (!info.isFile() || info.size > maximum * 2)
      throw new Error("Image text material budget exceeded");
    const page: unknown = JSON.parse(fs.read_text_file(file));
    if (!Check(IMAGE_TEXT_PAGE_SCHEMA, page))
      throw new Error("Invalid workspace render_image_text_page request.");
    let bytes = 0;
    for (const {
      size: [width, height],
      distance,
    } of page) {
      const size = width * height * 4;
      bytes += size;
      if (bytes > maximum || Buffer.byteLength(distance, "base64") !== size)
        throw new Error("Invalid image text distance field");
    }
    const paint = await options.host({ kind: request.kind, page }, signal);
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
  if (!Check(REQUEST, request))
    throw new Error("Invalid workspace render_image_text_page request.");
  if (!render) throw new Error("Image text renderer unavailable.");
  return render(request, signal);
}
