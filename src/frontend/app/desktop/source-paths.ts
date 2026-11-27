/** 空值校验不改写文件身份，按原值去重并保留首次顺序。 */
export function normalize_source_paths(source_paths: string[]): string[] {
  return [...new Set(source_paths.filter((source_path) => source_path.trim() !== ""))];
}

/** 虚拟文件和无法读取路径的拖拽来源都没有可用的本机路径。 */
export function read_file_path(file: File): string | null {
  try {
    return window.desktopApp.getPathForFile(file) || null;
  } catch {
    return null;
  }
}

/** 批量读取保留失败文件名，供接收方一次反馈。 */
export function read_file_paths(files: Iterable<File>): { paths: string[]; skipped: string[] } {
  const paths: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const path = read_file_path(file);
    if (path === null) skipped.push(file.name);
    else paths.push(path);
  }
  return { paths, skipped };
}
