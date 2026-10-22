import { has_language_character } from "../../domain/language";
import { scan_renpy_boundaries } from "./renpy-boundaries";

export type TextRuleType = "NONE" | "MD" | "KAG" | "WOLF" | "RENPY" | "RPGMAKER" | "GODOT";
export type TextFileContext = Readonly<{ file_type: string; game_engine?: string | undefined }>;

/** 文件上下文属于文件，规则类别只在文本处理与跨文件匹配时计算。 */
export function resolve_text_rule_type(
  item: { src?: string; file_type?: string },
  file?: TextFileContext,
): TextRuleType {
  switch (file?.file_type ?? item.file_type) {
    case "RPGMAKER_MV_MZ":
    case "RPGMAKER_RGSS":
      return "RPGMAKER";
    case "WOLFRPG":
    case "WOLFXLSX":
      return "WOLF";
    case "GODOT":
      return "GODOT";
    case "RENPY":
    case "RENPY_NATIVE":
      return "RENPY";
    case "MESSAGEJSON":
      return "KAG";
    case "MD_V2":
      return "MD";
    case "XLSX":
    case "KVJSON":
      return infer_item_text_type_from_source(item.src ?? "");
    case "TRANS": {
      const engine = file?.game_engine?.toLowerCase();
      if (engine === "kag" || engine === "vntrans") return "KAG";
      if (engine === "wolf" || engine === "wolfrpg") return "WOLF";
      if (engine === "renpy") return "RENPY";
      return ["2k", "2k3", "rmjdb", "rmxp", "rmvx", "rmvxace", "rmmv", "rmmz"].includes(
        engine ?? "",
      )
        ? "RPGMAKER"
        : "NONE";
    }
    default:
      return "NONE";
  }
}
const WOLF_PATTERNS = [
  /@\d+/iu, // 角色 ID
  /\\[cus]db\[.+?:.+?:.+?\]/iu, // 数据库变量 \cdb[0:1:2]
];
const RPGMAKER_PATTERNS = [
  /en\(.{0,8}[vs]\[\d+\].{0,16}\)/iu, // en(!s[982]) en(v[982] >= 1)
  /if\(.{0,8}[vs]\[\d+\].{0,16}\)/iu, // if(!s[982]) if(v[982] >= 1)
  /[/\\][a-z]{1,8}[<[][a-z\d]{0,16}[>\]]/iu, // /c[xy12] \bc[xy12] <\bc[xy12]>
];

/** 通用格式缺少引擎身份时，按控制语法选择文本规则。 */
function infer_item_text_type_from_source(src: string): TextRuleType {
  if (WOLF_PATTERNS.some((pattern) => pattern.test(src))) {
    return "WOLF";
  }
  if (RPGMAKER_PATTERNS.some((pattern) => pattern.test(src))) {
    return "RPGMAKER";
  }
  if (has_renpy_control_tag(src)) {
    return "RENPY";
  }
  return "NONE";
}

// Ren'Py 控制标签内不含日韩文本时才视为语法标签，避免误判正文括号
function has_renpy_control_tag(src: string): boolean {
  for (const match of scan_renpy_boundaries(src)) {
    const body = match.value.slice(1, -1);
    if (!has_language_character(body, "JA") && !has_language_character(body, "KO")) {
      return true;
    }
  }
  return false;
}
