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
    default_cleared: "已取消默认预设 …",
    default_set: "已设置为默认预设 …",
    deleted: "预设已删除 …",
    exists: "文件已存在 …",
    name_required: "预设名称不能为空",
    renamed: "预设已重命名 …",
    saved: "预设已保存 …",
  },
} as const;
