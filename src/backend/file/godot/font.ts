import { read_resource, patch_resource } from "./resource";
import { u32 } from "./binary";
const FALLBACK_CLASSES = new Set(["FontFile", "SystemFont"]);
/**
 * 作者显式关闭的系统回退恢复为引擎默认值，以使用系统中文字形。
 * 默认值省略于二进制资源，只需修改显式的 false，等长 bool 写回保留资源坐标。
 */
export function enable_system_fallback(bytes: Buffer): Buffer {
  const edits = read_resource(bytes)
    .properties.filter(
      (p) =>
        FALLBACK_CLASSES.has(p.className) &&
        p.name === "allow_system_fallback" &&
        p.value.type === 2 &&
        p.value.value === false,
    )
    .map((p) => ({ start: p.value.start + 4, end: p.value.start + 8, bytes: u32(1) }));
  return patch_resource(bytes, edits);
}
