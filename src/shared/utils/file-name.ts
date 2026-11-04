import { AppError } from "../error";

const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** 单段名称可在各平台创建：非空、无分隔符与 Windows 非法字符、不以点或空格结尾、非设备名。 */
export function is_portable_file_name(name: string): boolean {
  return (
    name !== "" &&
    !/[\\/:<>"|?*\p{Cc}]/u.test(name) &&
    !/[. ]$/u.test(name) &&
    !RESERVED_NAME.test(name)
  );
}

/** 新名称使用可跨平台管理的文件名；已有条目按磁盘事实定位。 */
export function validate_file_name(name: string): void {
  if (!is_portable_file_name(name)) throw new AppError("request.validation_failed");
}
