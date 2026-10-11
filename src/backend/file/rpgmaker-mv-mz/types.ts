// 引擎指令码是原稿协议，提取与写回共同引用。
export const RPGMAKER_EVENT = {
  MESSAGE: 101,
  MESSAGE_LINE: 401,
  CHOICES: 102,
  CHOICE_BRANCH: 402,
  CHOICES_END: 404,
  SCROLLING: 105,
  SCROLLING_LINE: 405,
  COMMENT: 108,
  COMMENT_LINE: 408,
  SCRIPT: 355,
  SCRIPT_LINE: 655,
  CONDITIONAL: 111,
  VARIABLES: 122,
  MOVE_SCRIPT: 45,
  ACTOR_NAME: 320,
  ACTOR_NICKNAME: 324,
  ACTOR_PROFILE: 325,
} as const;

export type JsonPath = (string | number)[]; // 字符串为对象键，数字为数组索引。
export type RPGMakerLocation =
  | { kind: "field"; path: JsonPath; mirrors?: JsonPath[] }
  | {
      kind: "block";
      path: JsonPath;
      start: number; // 原稿指令索引，`start/end` 为半开区间。
      end: number;
      code: number;
      name_path?: JsonPath;
    }
  | {
      kind: "script";
      container: Exclude<RPGMakerLocation, { kind: "script" }>;
      start: number; // 相对原脚本容器的 UTF-16 偏移。
      end: number;
      template: boolean;
    };
export type RPGMakerMetadata =
  | { usage: "display" | "metadata"; location: RPGMakerLocation }
  | { usage: "script"; location: RPGMakerLocation; source_context: string }; // 上下文摘录固定为导入原稿，译文编辑后仍保留。
