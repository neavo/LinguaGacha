import path from "node:path";
import { randomUUID } from "node:crypto";
import { Type, type Static } from "@earendil-works/pi-ai";
import { Check } from "typebox/value";
import type { NativeFs } from "../../../native/native-fs";
import {
  IMAGE_TEXT_PAGE_SCHEMA,
  IMAGE_TEXT_RULES,
  type ImageTextHost,
  type ImageTextPage,
} from "../../../shared/image-text";
import { AGENT_WORKSPACE_WORK_ROOT } from "../workspace/runtime/policy";

export const WORKSPACE_IMAGE_TEXT_REQUEST_SCHEMA = Type.Object(
  {
    kind: Type.Literal("render_image_text_page"),
    inputPath: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type WorkspaceImageTextRequest = Static<typeof WORKSPACE_IMAGE_TEXT_REQUEST_SCHEMA>;
export type WorkspaceImageTextPort = (
  request: WorkspaceImageTextRequest,
  signal: AbortSignal,
) => Promise<{ path: string }>;

/** 路径传输的大材料在进入 main 前完成尺寸、坐标与二进制长度校验。 */
export function validate_image_text_page(value: unknown): asserts value is ImageTextPage {
  if (!Check(IMAGE_TEXT_PAGE_SCHEMA, value) || value.width * value.height > 100_000_000)
    throw new Error("Invalid image text page");
  const ids = new Set<string>();
  let materialBytes = 0;
  for (const region of value.regions) {
    if (ids.has(region.regionId)) throw new Error("Duplicate image text region");
    ids.add(region.regionId);
    const candidateIds = new Set<string>();
    for (const candidate of region.candidates) {
      if (candidateIds.has(candidate.candidateId)) throw new Error("Duplicate text candidate");
      candidateIds.add(candidate.candidateId);
      const blockIds = new Set<string>();
      for (const block of candidate.blocks) {
        const [x, y, width, height] = block.box;
        if (
          blockIds.has(block.blockId) ||
          x < 0 ||
          y < 0 ||
          x + width > value.width ||
          y + height > value.height
        )
          throw new Error("Invalid image text block coordinates");
        blockIds.add(block.blockId);
        materialBytes += width * height * 4;
        if (materialBytes > IMAGE_TEXT_RULES.maximumMaterialBytes)
          throw new Error("Image text material exceeds byte budget");
        const binary = Buffer.from(block.distance, "base64");
        if (binary.length !== width * height * 4 || binary.toString("base64") !== block.distance)
          throw new Error("Invalid image text distance bytes");
        if (
          block.centroid.some(
            (coordinate, axis) =>
              !Number.isFinite(coordinate) || coordinate < 0 || coordinate > block.box[axis + 2]!,
          )
        )
          throw new Error("Invalid image text centroid");
      }
    }
  }
}

/** 父进程核验材料后调用宿主，结果交付前仍由本次请求负责清理。 */
export function create_image_text_renderer(options: {
  root: string;
  nativeFs: NativeFs;
  imageTextHost?: ImageTextHost | undefined;
}): WorkspaceImageTextPort {
  return async (request, signal) => {
    signal.throwIfAborted();
    if (!options.imageTextHost) throw new Error("Image text host unavailable");
    let page: ImageTextPage | null = null;
    if (request.inputPath !== null) {
      if (options.nativeFs.stat(request.inputPath).size > IMAGE_TEXT_RULES.maximumMaterialBytes)
        throw new Error("Image text material exceeds byte budget");
      const bytes = options.nativeFs.read_file(request.inputPath);
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      validate_image_text_page(value);
      page = value;
    }
    const result = await options.imageTextHost({ kind: "render_image_text_page", page }, signal);
    signal.throwIfAborted();
    const output = path.join(
      options.root,
      AGENT_WORKSPACE_WORK_ROOT,
      `${randomUUID()}.image-text.json`,
    );
    try {
      await options.nativeFs.write_file(output, JSON.stringify(result));
      signal.throwIfAborted(); // 异步写入期间取消时，回收尚未交给工作区的材料。
      return { path: output };
    } catch (cause) {
      try {
        options.nativeFs.unlink(output, { force: true });
      } catch (cleanupError) {
        throw new AggregateError([cause, cleanupError], "Image text material cleanup failed", {
          cause,
        });
      }
      throw cause;
    }
  };
}

/** 工作区 IPC 入口验证请求形状，宿主适配器验证文件内容。 */
export async function execute_image_text_request(
  request: unknown,
  signal: AbortSignal,
  host: WorkspaceImageTextPort | undefined,
) {
  if (!Check(WORKSPACE_IMAGE_TEXT_REQUEST_SCHEMA, request))
    throw new Error("Invalid workspace image text request");
  if (!host) throw new Error("Image text renderer unavailable");
  return host(request, signal);
}
