/** 空值校验不改写文件身份，按原值去重并保留首次顺序。 */
export function normalize_source_paths(source_paths: string[]): string[] {
  return [...new Set(source_paths.filter((source_path) => source_path.trim() !== ""))];
}

/** 虚拟文件与桥接异常统一交给调用方反馈。 */
export function read_file_paths(files: Iterable<File>): { paths: string[]; skipped: string[] } {
  const paths: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    let path = "";
    try {
      path = window.desktopApp.getPathForFile(file);
    } catch {
      // 拖拽源无法提供本机路径时，与虚拟文件一起反馈。
    }
    if (path === "") skipped.push(file.name);
    else paths.push(path);
  }
  return { paths, skipped };
}
