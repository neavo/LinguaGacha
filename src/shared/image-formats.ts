const RASTER_IMAGE_FORMATS = [
  { mime: "image/png", extensions: ["png"] },
  { mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { mime: "image/webp", extensions: ["webp"] },
  { mime: "image/bmp", extensions: ["bmp"] },
  { mime: "image/avif", extensions: ["avif"] },
  { mime: "image/gif", extensions: ["gif"] },
] as const; // 上传、回执与图片包共用光栅格式表。

const WORKSPACE_IMAGE_FORMATS = [
  ...RASTER_IMAGE_FORMATS,
  { mime: "image/svg+xml", extensions: ["svg"] },
] as const; // SVG 只进入工作区预览与资源引用保护。

export type SupportedRasterImageMime = (typeof RASTER_IMAGE_FORMATS)[number]["mime"];
type SupportedWorkspaceImageMime = (typeof WORKSPACE_IMAGE_FORMATS)[number]["mime"];

export const SUPPORTED_RASTER_IMAGE_EXTENSIONS: readonly string[] = Object.freeze(
  RASTER_IMAGE_FORMATS.flatMap(({ extensions }) => [...extensions]),
);
export const SUPPORTED_RASTER_IMAGE_MIMES: ReadonlySet<string> = new Set(
  RASTER_IMAGE_FORMATS.map(({ mime }) => mime),
);
export const SUPPORTED_WORKSPACE_IMAGE_EXTENSIONS: readonly string[] = Object.freeze(
  WORKSPACE_IMAGE_FORMATS.flatMap(({ extensions }) => [...extensions]),
);

function image_extension(filename: string): string {
  return /[^/\\]\.(\w+)$/u.exec(filename)?.[1]?.toLowerCase() ?? "";
}

/** 返回包内可保存的规范后缀，保留 jpg 与 jpeg 的区分。 */
export function resolve_raster_image_extension(filename: string): string | null {
  const extension = image_extension(filename);
  return SUPPORTED_RASTER_IMAGE_EXTENSIONS.includes(extension) ? extension : null;
}

/** 工作区按文件名预览，上传和模型看图另按内容识别。 */
export function resolve_workspace_image_mime(filename: string): SupportedWorkspaceImageMime | null {
  const extension = image_extension(filename);
  for (const format of WORKSPACE_IMAGE_FORMATS) {
    const extensions: readonly string[] = format.extensions;
    if (extensions.includes(extension)) return format.mime;
  }
  return null;
}
