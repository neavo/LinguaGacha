/** 返回路径末段，目录路径末尾的分隔符不影响结果。 */
export function extract_file_name(file_path: string): string {
  return file_path.split(/[\\/]+/u).findLast((segment) => segment !== "") ?? file_path;
}

/** 返回文件所在目录，保留根目录和盘符。 */
export function extract_parent_dir(file_path: string): string {
  const index = Math.max(file_path.lastIndexOf("/"), file_path.lastIndexOf("\\"));
  if (index < 0) return "";
  if (index === 0 || (index === 2 && file_path[1] === ":")) return file_path.slice(0, index + 1);
  return file_path.slice(0, index);
}
