import type { AppErrorCode } from "./error/app-error";

export type SourceFileParseFailureRecord = {
  source_path: string; // 保留真实源路径，日志和调试需要定位原文件
  rel_path: string; // 工程或工作台内的目标相对路径，无法确定时为空串
  filename: string; // 日志正文使用短文件名，完整路径保留在上下文中。
  code: AppErrorCode; // 机器分类。
  message: string; // 解析源头保留的具体原因。
};
