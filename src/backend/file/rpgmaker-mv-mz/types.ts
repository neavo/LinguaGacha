export type JsonPath = (string | number)[]; // 字符串为对象键，数字为数组索引。
/** 根定位直接引用固化原稿中的字段或事件范围。 */
export type RPGMakerRootLocation =
  | { kind: "field"; path: JsonPath; mirrors?: JsonPath[] }
  | {
      kind: "block";
      path: JsonPath;
      start: number; // 原稿指令索引，`start/end` 为半开区间。
      end: number;
      code: number;
      name_path?: JsonPath;
    };
/** 每层容器只保存自身坐标与父定位，供提取上下文和递归写回共用。 */
export type RPGMakerLocation =
  | RPGMakerRootLocation
  | {
      kind: "script";
      container: RPGMakerLocation;
      start: number; // 相对原脚本容器的 UTF-16 偏移。
      end: number;
      template: boolean;
    }
  | { kind: "json"; container: RPGMakerLocation; path: JsonPath };
export type RPGMakerUsage = "text" | "metadata";
export type RPGMakerMetadata = {
  internal_file_path: string;
  usage: RPGMakerUsage;
  location: RPGMakerLocation;
  source_context?: string; // 上下文固定为导入原稿，与翻译用途独立。
};
