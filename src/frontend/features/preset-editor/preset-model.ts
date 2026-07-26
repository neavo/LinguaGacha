import type { PresetInputState, PresetItem } from "./preset-types";

/**
 * 关闭弹窗时一并清空提交态和目标，避免下次打开继承上一次操作。
 */
export function create_empty_preset_input_state(): PresetInputState {
  return {
    open: false,
    mode: null,
    value: "",
    submitting: false,
    target_virtual_id: null,
  };
}

/**
 * 沿用后端预设接口识别的虚拟文件 ID，不在页面内拼接真实路径。
 */
export function build_user_preset_virtual_id(
  name: string,
  extension: "json" | "txt" = "json",
): string {
  return `user:${name}.${extension}`;
}

/**
 * 预设名只裁掉首尾空白，文件名合法性继续由后端写入边界负责。
 */
export function normalize_preset_name(name: string): string {
  return name.trim();
}

/**
 * 重名检查只覆盖用户预设，并在重命名时排除当前虚拟 ID。
 */
export function has_casefold_duplicate_preset(
  preset_items: readonly PresetItem[],
  target_virtual_id: string,
  current_virtual_id: string | null,
): boolean {
  const target_key = target_virtual_id.toLocaleLowerCase();

  return preset_items.some((item) => {
    return (
      item.type === "user" &&
      item.virtual_id !== current_virtual_id &&
      item.virtual_id.toLocaleLowerCase() === target_key
    );
  });
}

/**
 * 保持“内置在前、用户在后”的菜单顺序，并从设置快照投影唯一默认项。
 */
export function decorate_preset_items(
  builtin_presets: readonly PresetItem[],
  user_presets: readonly PresetItem[],
  default_virtual_id: string,
): PresetItem[] {
  return [...builtin_presets, ...user_presets].map((item) => ({
    ...item,
    is_default: item.virtual_id === default_virtual_id,
  }));
}
