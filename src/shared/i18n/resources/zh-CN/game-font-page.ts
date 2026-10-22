export const zh_cn_game_font_page = {
  title: "修改游戏字体",
  fields: {
    game: { title: "游戏", description: "点击或拖拽游戏程序或目录" },
    font_file: { title: "字体文件", description: "点击或拖拽字体文件", hint: "支持 TTF" },
  },
  action: { pick_executable: "选择游戏程序", pick_directory: "选择游戏目录", start: "开始修改" },
  feedback: {
    inspect_failed: "识别失败 …",
    apply_failed: "修改失败 …",
    applying: "正在修改游戏字体 …",
    apply_success: "游戏字体修改完成 …",
  },
} as const;
