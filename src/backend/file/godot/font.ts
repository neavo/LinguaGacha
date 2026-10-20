import { read_resource, patch_resource } from "./resource";
import assert from "node:assert/strict";
import { GODOT_RESOURCE_MAX_BYTES, pad, string, u32, u64 } from "./binary";
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

export const FONT_TOOL_RESOURCE = "lg_font.fontdata"; // 所有 FontFile 导入共用的资源文件名，映射写作 res:// 路径。

/** 最小 Godot 4 RSRC 只保存 `data`，系统回退等选项沿用引擎默认值。 */
export function build_font_data(bytes: Uint8Array): Buffer {
  assert(bytes.length <= GODOT_RESOURCE_MAX_BYTES, "Font exceeds processing limit");
  const header = Buffer.concat([
    Buffer.from("RSRC"),
    u32(0),
    u32(0),
    u32(4),
    u32(0),
    u32(3),
    string("FontFile", true),
    u64(0),
    u32(0),
    Buffer.alloc(8, 255),
    Buffer.alloc(44),
    u32(1),
    string("data", true),
    u32(0),
    u32(1),
    string("local://1", true),
  ]);
  return Buffer.concat([
    header,
    u64(header.length + 8),
    string("FontFile", true),
    u32(1),
    u32(0),
    u32(31),
    u32(bytes.length),
    bytes,
    Buffer.alloc(pad(bytes.length)),
    Buffer.from("RSRC"),
  ]);
}

/** 只重定向 `FontFile` 导入，保留原路径、UID、导入选项与行尾。 */
export function remap_font_import(text: string): string | null {
  const lines = text.split(/(?<=\n)/u);
  let section = "",
    font = false;
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]/u.exec(line);
    if (header) section = header[1]!;
    else if (section === "remap" && /^\s*type\s*=\s*"FontFile"\s*$/u.test(line)) font = true;
  }
  if (!font) return null;
  section = "";
  let changed = false;
  const output = lines.map((line) => {
    const header = /^\s*\[([^\]]+)\]/u.exec(line);
    if (header) section = header[1]!;
    else if (section === "remap" && /^\s*path\s*=\s*"[^"]*"/u.test(line)) {
      changed = true;
      return line.replace(/^(\s*path\s*=\s*)"[^"]*"/u, `$1"res://${FONT_TOOL_RESOURCE}"`);
    }
    return line;
  });
  assert(changed, "FontFile import has no remap path");
  return output.join("");
}

/** 所有导入共享一份字体数据，与译文导出的原稿成员互不覆盖。 */
export function godot_font_outputs(
  files: ReadonlyMap<string, Uint8Array>,
  font: Uint8Array,
): Map<string, Uint8Array> {
  const outputs = new Map<string, Uint8Array>();
  for (const [name, bytes] of files) {
    const remapped = remap_font_import(Buffer.from(bytes).toString("utf8"));
    if (remapped !== null) outputs.set(name, Buffer.from(remapped));
  }
  assert(outputs.size, "No font files found");
  outputs.set(FONT_TOOL_RESOURCE, build_font_data(font));
  return outputs;
}
