export const zh_cn_preset_editor = {
  action: {
    apply: "导入",
    cancel_default: "取消默认预设",
    delete: "删除预设",
    rename: "重命名",
    save: "保存预设",
    set_default: "设为默认预设",
  },
  confirm: {
    delete: {
      description: "是否确认删除预设 …?",
    },
    overwrite: {
      description: "是否确认覆盖预设 …?",
    },
  },
  dialog: {
    name_placeholder: "请输入预设名称 …",
  },
  feedback: {
    exists: "文件已存在",
    name_required: "预设名称不能为空",
    load_failed: "预设加载失败",
    save_failed: "预设保存失败",
    rename_failed: "预设重命名失败",
    delete_failed: "预设删除失败",
    default_update_failed: "默认预设设置保存失败",
  },
} as const;
