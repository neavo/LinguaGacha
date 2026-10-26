import type { PythonConstant } from "./python-syntax";

export type RenpyUsage = "say" | "menu" | "display" | "paragraph" | "code" | "string";

/** 调用名到显示参数名的绑定。关键字绑定属于具体引擎接口，未知调用不从参数名称推测用途。 */
export const DISPLAY_CALLS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  _: ["s"],
  __: ["s"],
  ___: ["s"],
  Character: ["name"],
  Text: ["text"],
  Notify: ["message"],
  Confirm: ["prompt"],
  "renpy.notify": ["message"],
  "renpy.input": ["prompt"],
});
/** 任意调用中这些关键字参数都按显示处理，例如 `narrator.add_history(what=…)`。 */
export const DISPLAY_KEYWORDS: readonly string[] = Object.freeze([
  "what",
  "tooltip",
  "alt",
  "prompt",
]);
/** 整个右值都是玩家可见文本的 `define` 目标。 */
export const DISPLAY_DEFINES: readonly string[] = Object.freeze([
  "config.name",
  "config.window_title",
  "gui.about",
]);
/** SL2 控件按 `displayable` 的限定名后缀识别，首个位置参数是显示文本。 */
export const DISPLAY_SCREEN_DISPLAYABLES: readonly string[] = Object.freeze([
  "text.Text",
  "ui._textbutton",
  "ui._label",
]);
/** SL2 控件中按显示处理的属性。 */
export const DISPLAY_SCREEN_KEYWORDS: readonly string[] = Object.freeze(["text", "tooltip", "alt"]);
/** 6.99 旧式界面语言中首个位置参数为显示文本的调用。 */
export const LEGACY_DISPLAY_CALLS: readonly string[] = Object.freeze([
  "text",
  "textbutton",
  "label",
  "Character",
  "Text",
  "_",
  "__",
  "___",
  "_p",
]);

/** 参数位置与外层表达式确定用途，字面量能否独立写回由提取层判断。 */
export function string_usage(token: PythonConstant, display: boolean): RenpyUsage {
  const binding = token.argument;
  const matches = (index: number, names: readonly string[]) =>
    binding?.kind === "positional"
      ? binding.index === index
      : binding?.kind === "keyword" && names.includes(binding.name);
  if (token.call === "_p" && matches(0, ["s"])) return "paragraph";
  if (token.call === "renpy.say" && matches(1, ["what"])) return "say";
  if (
    (display && token.whole) ||
    (Object.hasOwn(DISPLAY_CALLS, token.call) && matches(0, DISPLAY_CALLS[token.call]!)) ||
    (binding?.kind === "keyword" && DISPLAY_KEYWORDS.includes(binding.name))
  )
    return "display";
  return "code";
}
