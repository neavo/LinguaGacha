export const AGENT_IMAGE_DEFAULT_MAX_EDGE = 1920; // 附件和未指定尺寸的工作区图片共用默认值。
export const AGENT_IMAGE_MAX_EDGE = 3840; // 工作区请求 Schema 校验的单次尺寸上限。

/** 单次看图按内容选择尺寸，后端继续控制像素和字节额度。 */
export type AgentImageOptions = Readonly<{ maxEdge?: number }>;

/** 图片策略由后端确定，宿主只执行 Chromium 解码与编码。 */
export type AgentImagePolicy = Readonly<{
  maxEdge: number;
  maxPixels: number;
  maxBytes: number;
  quality: number;
}>;

export type AgentImage = Readonly<{
  data: string;
  mimeType: "image/webp";
  width: number;
  height: number;
  originalWidth: number; // 缩放前的尺寸为模型裁剪定位保留坐标映射依据
  originalHeight: number;
}>;

export type AgentImageHostOperation = Readonly<{
  kind: "prepare_image";
  bytes: Uint8Array;
  mimeType: string;
  policy: AgentImagePolicy;
}>;

export type AgentImageHostResult = Readonly<{
  bytes: Uint8Array;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}>;

export type AgentImageHost = (
  operation: AgentImageHostOperation,
  signal: AbortSignal,
) => Promise<AgentImageHostResult>;
