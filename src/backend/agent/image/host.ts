import path from "node:path";
import { randomUUID } from "node:crypto";
import { default_native_fs as fs } from "../../../native/native-fs";
import { Check } from "typebox/value";
import {
  IMAGE_LAYOUT_SCHEMA,
  type ImageHost,
  type ImageLayoutRequest,
  type ImageLayoutResult,
} from "../../../shared/image";

export type ImageLayoutPort = (
  request: ImageLayoutRequest,
  signal: AbortSignal,
) => Promise<ImageLayoutResult>; // 暴露给工作区脚本的排版宿主端口。

/** 工作区提交结构化文字和矩形尺寸，输出位置由宿主分配。 */
export function create_image_layout_port(root: string, host?: ImageHost): ImageLayoutPort {
  return async (request, signal) => {
    if (!Check(IMAGE_LAYOUT_SCHEMA, request)) throw new Error("Invalid image layout request");
    if (!host) throw new Error("Image layout host unavailable");
    const work = fs.real_path(path.join(root, "work"));
    return await host(
      { ...request, outputDirectory: path.join(work, "image-layers", randomUUID()) },
      signal,
    );
  };
}
