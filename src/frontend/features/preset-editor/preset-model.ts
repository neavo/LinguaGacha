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
 * 按 NFC 忽略大小写检查用户预设重名，重命名时排除当前预设。
 */
export function has_casefold_duplicate_preset(
  preset_items: readonly PresetItem[],
  target_virtual_id: string,
  current_virtual_id: string | null,
): boolean {
  const target_key = target_virtual_id.normalize("NFC").toLocaleLowerCase();
  const current_id = current_virtual_id?.normalize("NFC"); // 已有规则预设可能仍使用磁盘原名。
  return preset_items.some((item) => {
    const id = item.virtual_id.normalize("NFC");
    return item.type === "user" && id !== current_id && id.toLocaleLowerCase() === target_key;
  });
}

/**
 * 内置预设排在用户预设之前，按等价 ID 标记已有设置中的默认项。
 */
export function decorate_preset_items(
  builtin_presets: readonly PresetItem[],
  user_presets: readonly PresetItem[],
  default_virtual_id: string,
): PresetItem[] {
  const default_id = default_virtual_id.normalize("NFC");
  return [...builtin_presets, ...user_presets].map((item) => ({
    ...item,
    is_default: item.virtual_id.normalize("NFC") === default_id,
  }));
}
