import { read_resource, patch_resource } from "./resource";
import assert from "node:assert/strict";
import { GODOT_RESOURCE_MAX_BYTES, pad, string, u32, u64 } from "./binary";
import { read_project } from "./project";
const FALLBACK_CLASSES = new Set(["FontFile", "SystemFont"]); // 带 allow_system_fallback 属性的字体资源类。
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

const FONT_TOOL_RESOURCE = "lg_font.fontdata"; // 导入映射与默认主题字体共用的资源文件名。
const OVERRIDE_FILE = "override.cfg"; // 引擎读取资源根目录与 EXE 目录中的该文件，散装准备后两者都是游戏根目录。
/** 引擎按顺序读取 `override.cfg`，末尾这一节覆盖较早的同名设置。 */
const DEFAULT_FONT_OVERRIDE = `[gui]\ntheme/custom_font="res://${FONT_TOOL_RESOURCE}"\n`;
const DISABLE_OVERRIDE = "application/config/disable_project_settings_override"; // Godot 4.6 起可关闭覆盖。

/**
 * 字体修改改写的成员：FontFile 导入映射与游戏根目录的 `override.cfg`。
 * 只含工具这一节的 `override.cfg` 是工具产物，不收集，避免后续导入把它当原件备份。
 */
export function is_godot_font_file(name: string, read: (name: string) => Uint8Array): boolean {
  const lower = name.toLowerCase();
  if (lower === OVERRIDE_FILE) return text(read(name)) !== DEFAULT_FONT_OVERRIDE;
  return lower.endsWith(".import") && remap_font_import(text(read(name))) !== null;
}

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

/** 导入映射与默认主题字体共用字体数据，两者均在原稿容器外，与译文导出顺序无关。 */
export function godot_font_outputs(
  data: ReadonlyMap<string, Uint8Array>,
  fonts: ReadonlyMap<string, Uint8Array>,
  font: Uint8Array,
): Map<string, Uint8Array> {
  const outputs = new Map<string, Uint8Array>();
  let override = { name: OVERRIDE_FILE, text: "" }; // 工具产物未被收集，按新建处理仍写出相同字节。
  for (const [name, bytes] of fonts)
    if (name.toLowerCase() === OVERRIDE_FILE) override = { name, text: text(bytes) };
    else outputs.set(name, Buffer.from(remap_font_import(text(bytes))!)); // 收集时已确认是 FontFile 导入。
  // 项目关闭覆盖时引擎不读 `override.cfg`，未指定字体的控件继续经系统回退显示。
  if (!override_disabled(data.get("project.binary")!))
    outputs.set(override.name, Buffer.from(with_default_font(override.text)));
  assert(outputs.size, "No font files found");
  outputs.set(FONT_TOOL_RESOURCE, build_font_data(font));
  return outputs;
}

/** 已以工具这一节结尾时原样返回，使重复执行不改变文件。 */
function with_default_font(current: string): string {
  if (current.endsWith(DEFAULT_FONT_OVERRIDE)) return current;
  return (current && !current.endsWith("\n") ? current + "\n" : current) + DEFAULT_FONT_OVERRIDE;
}

/** 读取项目是否让引擎跳过 `override.cfg`。 */
function override_disabled(project: Uint8Array): boolean {
  return read_project(Buffer.from(project)).some(
    (setting) => setting.name === DISABLE_OVERRIDE && setting.value.value === true,
  );
}

const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString("utf8"); // 导入映射与 override.cfg 都是 UTF-8 文本。
