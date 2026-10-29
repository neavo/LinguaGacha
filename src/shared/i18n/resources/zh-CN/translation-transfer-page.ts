export const zh_cn_translation_transfer_page = {
  title: "译文迁移",
  fields: {
    source: { title: "迁出工程" },
    base: { title: "迁入工程" },
    mode: {
      title: "迁移模式",
      fill: "填充",
      overwrite: "覆盖",
      fill_description: "出现冲突时，优先保留迁入工程中的译文",
      overwrite_description: "出现冲突时，优先使用迁出工程中的译文",
    },
  },
  action: { start: "生成新工程" },
  feedback: {
    result: "填充 {FILLED} 条 · 替换 {REPLACED} 条 · 未匹配 {UNMATCHED} 条",
  },
} as const;
