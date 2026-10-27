/** 返回文件所在目录，保留根目录和盘符。 */
export function extract_parent_dir(file_path: string): string {
  const index = Math.max(file_path.lastIndexOf("/"), file_path.lastIndexOf("\\"));
  if (index < 0) return "";
  if (index === 0 || (index === 2 && file_path[1] === ":")) return file_path.slice(0, index + 1);
  return file_path.slice(0, index);
}
