/** 集合变化后重新预览，防止执行时静默改用另一份顺序。 */
export const GODOT_PACK_ORDER_REFRESH_ACTION = "refresh_godot_packs";

export type GodotPackPreview = Readonly<{
  game_root: string;
  game_name: string;
  external_pcks: readonly string[]; // 零包和单包也保留，用于检查预览后新增的包。
}>;

export type GodotPackOrder = Readonly<{
  game_root: string;
  ordered_pcks: readonly string[]; // 当前游戏的完整排列，每个包名只出现一次。
}>;
