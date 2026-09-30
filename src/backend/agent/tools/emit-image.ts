import { Check } from "typebox/value";
import type { AgentImage, AgentImageOptions } from "../../../shared/agent-image";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "../workspace/runtime/policy";
import { create_schema_renderer } from "../workspace/schema-description";
import type { AgentWorkspaceRequestChannel } from "../workspace/runtime/request-channel";
import { Type } from "@earendil-works/pi-ai";
import { AGENT_IMAGE_DEFAULT_MAX_EDGE, AGENT_IMAGE_MAX_EDGE } from "../../../shared/agent-image";
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

/** 模型声明与校验复用图片选项。 */
export function describe_emit_image(): string {
  return (
    "/** 输出工作区图片，按调用顺序返回。await 完成后内容已固定，模型在程序成功返回后看到图片。 */\n" +
    `emitImage(path: string, options?: ${create_schema_renderer(new Map()).render(WORKSPACE_IMAGE_OPTIONS_SCHEMA)}): Promise<void>;`
  );
}
/** 只借用请求通道，执行状态由父进程持有。 */
export function bind_emit_image(channel: Pick<AgentWorkspaceRequestChannel, "call">) {
  return async (path: string, options?: AgentImageOptions): Promise<void> => {
    await channel.call({ kind: "emit_image", path, ...(options === undefined ? {} : { options }) });
  };
}

/** 每次程序独立持有输出状态，工作区端口负责受控文件读取和图片转换。 */
export function create_image_output(
  prepare: (path: string, signal: AbortSignal, options?: AgentImageOptions) => Promise<AgentImage>,
) {
  // 槽位按请求到达顺序分配，异步转换完成顺序不能改变模型看到的图片顺序。
  const output_images = new Set<{ path: string; image: AgentImage | null }>();
  let image_bytes = 0; // 仅累计已接收图片的 base64 字节，本次程序结束后释放额度。
  /** 预留调用顺序和额度，失败时释放槽位供本次程序重试。 */
  const emitImage = async (
    relative: string,
    image_signal: AbortSignal,
    options?: AgentImageOptions,
  ) => {
    image_signal.throwIfAborted();
    if (output_images.size >= AGENT_WORKSPACE_RUNTIME_POLICY.imageCount)
      throw new Error(
        `Cannot emit ${JSON.stringify(relative)}: this program accepts at most ${AGENT_WORKSPACE_RUNTIME_POLICY.imageCount} images. Emit remaining images in subsequent workspace_run calls.`,
      );
    const entry = { path: relative, image: null as AgentImage | null };
    output_images.add(entry);
    try {
      const image = await prepare(relative, image_signal, options);
      image_signal.throwIfAborted();
      if (image_bytes + image.data.length > AGENT_WORKSPACE_RUNTIME_POLICY.imageOutputBytes)
        throw new Error(
          `Cannot emit ${JSON.stringify(relative)}: total encoded image data would exceed ${AGENT_WORKSPACE_RUNTIME_POLICY.imageOutputBytes / 1024 / 1024} MiB for this program. Split images across subsequent workspace_run calls, or crop relevant regions or lower maxEdge before retrying.`,
        );
      image_bytes += image.data.length;
      entry.image = image;
    } finally {
      // 被拒绝的请求释放预留槽位，脚本捕获错误后仍可继续输出。
      if (entry.image === null) output_images.delete(entry);
    }
  };
  return {
    emitImage,
    /** 读取已完成输出，跳过尚未结算的预留槽位。 */
    read: () =>
      [...output_images.values()].flatMap(({ path, image }) =>
        image === null ? [] : [{ path, image }],
      ),
  };
}

/** 父进程在图片工具入口校验完整请求，再读取工作区文件。 */
export async function execute_image_request(
  request: unknown,
  signal: AbortSignal,
  emit: ReturnType<typeof create_image_output>["emitImage"] | undefined,
) {
  if (!Check(WORKSPACE_IMAGE_REQUEST_SCHEMA, request) || !emit)
    throw new Error("Invalid workspace image request.");
  await emit(request.path, signal, request.options);
  return null;
}

/** 模型回执仅投影元数据，图片字节通过独立内容块交付。 */
export function summarize_images(images: readonly { path: string; image: AgentImage }[]) {
  return images.map(({ path, image }) => ({
    path,
    mime_type: image.mimeType,
    width: image.width,
    height: image.height,
    original_width: image.originalWidth,
    original_height: image.originalHeight,
  }));
}
