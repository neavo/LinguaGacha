import path from "node:path";
import { read_resource_type } from "./resource";

type MemberKind = "project" | "gd" | "po" | "gdsc" | "resource" | "translation";
const EXTENSION_KINDS: Readonly<Record<string, MemberKind>> = {
  ".gd": "gd",
  ".po": "po",
  ".gdc": "gdsc",
  ".scn": "resource",
  ".res": "resource",
  ".translation": "translation",
};

/**
 * 文件名发现候选，忽略扩展名大小写；有字节时以二进制文件头及资源顶层类型为准。
 * 二进制资源可以用任意资源扩展名保存语言表，路径本身保持原样。
 */
export function godot_member_kind(file: string, bytes?: Buffer): MemberKind | null {
  if (file === "project.binary") return "project";
  const magic = bytes?.toString("ascii", 0, 4);
  if (magic === "GDSC") return "gdsc";
  if (bytes && (magic === "RSRC" || magic === "RSCC"))
    return is_translation_type(read_resource_type((length) => bytes.subarray(0, length)))
      ? "translation"
      : "resource";
  return EXTENSION_KINDS[path.extname(file).toLowerCase()] ?? null;
}

export const is_translation_type = (type: string): boolean =>
  ["OptimizedTranslation", "Translation", "TranslationPO"].includes(type); // 三种类型都通过 `messages` 或槽位提供译文。
