import type { RenpyProfile } from "./profile";

/** 静态初始化声明的来源位置。 */
export type RenpyInitPosition = Readonly<{
  file: string; // 编译脚本成员路径，`renpy/common/` 表示引擎公共脚本。
  early: boolean; // `EarlyPython` 在脚本加载期间执行，先于全部 Init。
  priority: number;
}>;
/** 引擎兼容设置的实际来源：`00compat` 在 `init -1000` 读取 `script_version.txt`。 */
export const RENPY_COMPAT_SCRIPT = "renpy/common/00compat.rpyc";
export const RENPY_COMPAT_PRIORITY = -1000;

/**
 * 按引擎执行顺序返回声明副本：早期代码按脚本加载顺序先执行，Init 按优先级稳定排序，
 * 同一脚本内保留声明顺序。脚本加载顺序沿用 `script.sort_script_files`。
 */
export function order_initialization<T extends RenpyInitPosition>(
  declarations: readonly T[],
  profile: Pick<RenpyProfile, "script_order">,
  files: ReadonlySet<string>, // 本次有效文件清单，提供 libs/mods 分组标记。
): T[] {
  const file_key = (file: string): [number, string, string] => {
    const common = file.startsWith("renpy/common/");
    const name = file.slice(common ? "renpy/common/".length : "game/".length, -".rpyc".length);
    // 旧引擎把公共与游戏脚本一并按脚本名排序，新引擎先加载公共脚本。
    if (profile.script_order === "filename") return [0, name, file];
    if (common) return [-1, name, name];
    let group = 1;
    if (files.has("game/libs/libs.txt") && name.startsWith("libs/")) group = 0;
    if (files.has("game/mods/mods.txt") && name.startsWith("mods/")) group = 2;
    const parts = name.split("/");
    const key = group === 1 ? name : parts.slice(parts.length > 2 ? 2 : 1).join("/");
    return [group * 2 + Number(name >= "A"), key, name];
  };
  // 引擎按字符比较路径，区域排序会改变同优先级声明的覆盖顺序。
  const compare_files = (a: string, b: string): number => {
    const left = file_key(a),
      right = file_key(b);
    return (
      left[0] - right[0] ||
      (left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0) ||
      (left[2] < right[2] ? -1 : left[2] > right[2] ? 1 : 0)
    );
  };
  return [...declarations].sort(
    (a, b) =>
      Number(b.early) - Number(a.early) ||
      (a.early ? 0 : a.priority - b.priority) ||
      compare_files(a.file, b.file),
  );
}
