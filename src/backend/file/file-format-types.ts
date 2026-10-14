import type { PDFDocument } from "../../shared/pdf";
import type { Item, ItemFileType } from "../../domain/item";

/** 解析器语法诊断供后端日志定位，位置按脚本内 UTF-16 列计数。 */
export type ScriptDiagnostic = Readonly<{
  message: string;
  line: number | null; // 脚本内从 1 开始的位置，解析器未提供定位时为空。
  column: number | null;
}>;

/** 跳过的内部文件或脚本统一记录诊断，已取得的原稿仍参与保存和导出。 */
export type SourceFileParseWarning = Readonly<{
  code: "script_syntax_error" | "internal_file_parse_failed";
  rel_path: string;
  internal_file_path?: string;
  location?: string; // 格式私有定位在日志边界转成可读位置。
  json_path?: readonly (string | number)[];
  diagnostics: readonly ScriptDiagnostic[];
}>;

/** 普通文件与条目共用类型值，PDF 通过独立文档参与导入。 */
export type ProjectFileType = ItemFileType | "PDF";
/** 文件级成功可以附带局部提取警告，由操作拥有者记录日志。 */
export type FileFormatReadResult =
  | {
      kind: "items";
      items: Item[];
      file_type: ItemFileType;
      game_engine?: string; // TRANS 导入继承使用的文本规则上下文。
      warnings?: SourceFileParseWarning[];
    }
  | { kind: "pdf"; document: PDFDocument };

/** 文件格式处理器共享配置，来源于应用设置或测试显式注入。 */
export interface FileFormatServiceConfig {
  target_language: string; // 决定 EPUB 阅读排版等目标语言写回策略
  deduplication_in_bilingual?: boolean; // 原译文相同时双语文件只写一份
  write_translated_name_fields_to_file?: boolean; // 姓名字段是否使用译名写回
}

/**
 * 来源发现阶段保存源文件绝对路径与工程内相对路径的映射
 */
export interface ProjectSourceFileEntry {
  file_type?: string | undefined;
  source_path: string; // 用户选择或目录扫描得到的真实文件路径
  rel_path: string; // 导入工程后的稳定资产路径
}

/**
 * 译文与双语对照目录由同一生成入口确定。
 */
export interface GeneratedFilePaths {
  translated_path: string; // 单语译文根目录
  bilingual_path: string; // 双语对照根目录
}

/** 全部格式共享的写回上下文，源资产由工程提供。 */
export interface FileFormatWriteContext {
  paths: GeneratedFilePaths;
  asset_reader: (rel_path: string) => Buffer | null | Promise<Buffer | null>;
}

/** 文件调度拥有源文件集合，单格式写回上下文只携带 IO。 */
export type FileFormatServiceWriteContext = FileFormatWriteContext & {
  source_files: readonly { path: string; file_type: string }[]; // 原始资产的文件集合，零条目字幕也参与导出
};
