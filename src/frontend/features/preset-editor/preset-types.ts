/**
 * 跨页面预设菜单只依赖稳定虚拟 ID；真实路径只供后端返回的用户预设透传。
 */
export type PresetItem = {
  name: string;
  virtual_id: string;
  type: "builtin" | "user";
  path?: string;
  is_default?: boolean;
};

/**
 * 用判别联合约束弹窗生命周期：关闭时不允许保留可提交的操作模式。
 */
export type PresetInputState =
  | {
      open: false;
      mode: null;
      value: string;
      submitting: boolean;
      target_virtual_id: string | null;
    }
  | {
      open: true;
      mode: "save" | "rename";
      value: string;
      submitting: boolean;
      target_virtual_id: string | null;
    };
