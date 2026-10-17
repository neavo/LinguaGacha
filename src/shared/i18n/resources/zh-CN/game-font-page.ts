export const zh_cn_game_font_page = {
  title: "游戏字体替换",
  fields: {
    font_file: { title: "字体文件", description: "选择 TTF 或 OTF 字体文件" },
    game_path: { title: "游戏程序", description: "选择游戏的启动程序" },
  },
  action: { pick_file: "选择文件", pick_executable: "选择 EXE", start: "开始替换" },
  confirm: { description: "是否确认替换 …?" },
  feedback: {
    inspect_failed: "识别失败 …",
    apply_failed: "替换失败 …",
    applying: "正在替换游戏字体 …",
    apply_success: "字体替换完成 …",
  },
} as const;
