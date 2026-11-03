import { AppError } from "../error";

const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** 新名称使用可跨平台管理的文件名；已有条目按磁盘事实定位。 */
export function validate_file_name(name: string): void {
  if (
    !name ||
    /[\\/:<>"|?*]/.test(name) ||
    [...name].some((char) => char.charCodeAt(0) < 32) ||
    /[. ]$/.test(name) ||
    RESERVED_NAME.test(name)
  ) {
    throw new AppError("request.validation_failed");
  }
}
