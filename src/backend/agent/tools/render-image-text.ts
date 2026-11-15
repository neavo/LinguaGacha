import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
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
    inputSha256: Type.Union([Type.String({ pattern: "^[a-f0-9]{64}$" }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type WorkspaceImageTextRequest = Static<typeof WORKSPACE_IMAGE_TEXT_REQUEST_SCHEMA>;
export type WorkspaceImageTextPort = (
  request: WorkspaceImageTextRequest,
  signal: AbortSignal,
) => Promise<{ path: string }>;

/** 路径传输的大材料在进入 main 前完成尺寸、摘要、坐标与有限数值校验。 */
export function validate_image_text_page(value: unknown): asserts value is ImageTextPage {
  if (!Check(IMAGE_TEXT_PAGE_SCHEMA, value) || value.width * value.height > 100_000_000)
    throw new Error("Invalid image text page");
  const ids = new Set<string>();
  let materialBytes = 0;
  for (const region of value.regions) {
    const [x, y, width, height] = region.box;
    const id = JSON.stringify([region.regionId, region.blockId]);
    if (ids.has(id) || x < 0 || y < 0 || x + width > value.width || y + height > value.height)
      throw new Error("Invalid image text region coordinates");
    ids.add(id);
    materialBytes += width * height * 4;
    if (materialBytes > IMAGE_TEXT_RULES.maximumMaterialBytes)
      throw new Error("Image text material exceeds byte budget");
    const binary = Buffer.from(region.distance, "base64");
    if (binary.length !== width * height * 4 || binary.toString("base64") !== region.distance)
      throw new Error("Invalid image text distance bytes");
    const maximumDistance = Math.hypot(width, height); // 同一区域的距离上界只算一次。
    for (let i = 0; i < binary.length; i += 4) {
      const distance = binary.readFloatLE(i);
      if (!Number.isFinite(distance) || distance < 0 || distance > maximumDistance)
        throw new Error("Invalid image text distance field");
    }
    if (
      region.centroid.some(
        (coordinate, axis) =>
          !Number.isFinite(coordinate) || coordinate < 0 || coordinate > region.box[axis + 2]!,
      )
    )
      throw new Error("Invalid image text centroid");
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
      if (createHash("sha256").update(bytes).digest("hex") !== request.inputSha256)
        throw new Error("Image text material digest mismatch");
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      validate_image_text_page(value);
      page = value;
    } else if (request.inputSha256 !== null)
      throw new Error("Invalid image text environment request");
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
