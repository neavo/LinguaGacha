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
) => Promise<ImageLayoutResult>;

/** 工作区只能提交其工作目录内的掩码，输出位置由宿主分配。 */
export function create_image_layout_port(root: string, host?: ImageHost): ImageLayoutPort {
  return async (request, signal) => {
    if (!Check(IMAGE_LAYOUT_SCHEMA, request)) throw new Error("Invalid image layout request");
    if (!host) throw new Error("Image layout host unavailable");
    const work = fs.real_path(path.join(root, "work"));
    const regions = [];
    for (const region of request.regions) {
      const mask = fs.real_path(region.mask);
      const relative = path.relative(work, mask);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("Image mask outside workspace");
      regions.push({ ...region, mask });
    }
    return await host(
      { ...request, regions, outputDirectory: path.join(work, "image-layers", randomUUID()) },
      signal,
    );
  };
}
