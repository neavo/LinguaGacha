import assert from "node:assert/strict";

export const RENPY_GENERATED_MARKER = "# LinguaGacha RenPy generated v1";
export const RENPY_LANGUAGE_FILE = "game/zz_lg_language.rpy";
export const RENPY_STRINGS_FILE = "game/zz_lg_strings.rpy";
export const RENPY_FONT_FILE = "game/zz_lg_font.rpy";
const RENPY_GENERATED_FILES = [RENPY_LANGUAGE_FILE, RENPY_STRINGS_FILE, RENPY_FONT_FILE];

/** 归档不能激活保留资源，源码与编译产物共用固定路径。 */
export function is_generated_member(name: string): boolean {
  return RENPY_GENERATED_FILES.some(
    (file) => name.toLowerCase() === file || name.toLowerCase() === file + "c",
  );
}

/** 保留名称必须带产品标记，重导入同时排除源码和其编译产物。 */
export function generated_members(
  files: ReadonlyMap<string, string>,
  read: (name: string) => Uint8Array,
): Set<string> {
  const excluded = new Set<string>();
  // 先检查实际拼写，避免大小写变体绕过保留路径保护。
  for (const name of files.keys())
    if (is_generated_member(name))
      assert(name === name.toLowerCase(), "Reserved Ren'Py file conflict: " + name);
  for (const name of RENPY_GENERATED_FILES) {
    if (files.has(name)) {
      assert(
        Buffer.from(read(name))
          .toString("utf8")
          .startsWith(RENPY_GENERATED_MARKER + "\n"),
        "Reserved Ren'Py file conflict: " + name,
      );
      excluded.add(name);
      excluded.add(name + "c");
    } else
      assert(
        !files.has(name + "c"),
        "Orphaned LinguaGacha compiled resource; restore its generated source: " + name,
      );
  }
  return excluded;
}
