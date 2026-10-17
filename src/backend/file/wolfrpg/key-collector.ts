import type { WolfCommand } from "./commands";

const KEY_COMMAND = 1000,
  MASTER_KEY_OPTION = 7, // 首个整数参数为该值时，第二个字符串是 WolfX 主密钥。
  SET_STRING = 122,
  SET_INTEGER = 121;
// 事件指令可用绝对编号引用普通变量，归一化后与 WolfX 头中的编号一致。
const STRING_BASE = 3000000,
  INTEGER_BASE = 2000000,
  VARIABLE_RANGE = 1000000;
/** 主密钥默认含空串，变量按编号保存全部静态赋值。 */
export type WolfXCandidates = Readonly<{
  masters: Set<string>;
  strings: Map<number, Set<string>>;
  integers: Map<number, Set<number>>;
}>;

/** 创建一次准备共用的候选集合。 */
export function create_wolfx_candidates(): WolfXCandidates {
  return { masters: new Set([""]), strings: new Map(), integers: new Map() };
}

/** 把绝对变量编号归一化后加入候选。 */
function add_candidate<T>(
  values: Map<number, Set<T>>,
  variable: number,
  base: number,
  value: T,
): void {
  const id = variable >= base && variable < base + VARIABLE_RANGE ? variable - base : variable;
  values.set(id, (values.get(id) ?? new Set<T>()).add(value));
}

/** 赋值只提供候选，不执行表达式，分支中的所有取值均保留。 */
export function collect_wolfx_keys(
  commands: readonly WolfCommand[],
  candidates: WolfXCandidates,
): void {
  for (const { code, integers, strings } of commands) {
    if (code === KEY_COMMAND && integers[0] === MASTER_KEY_OPTION && strings[1] !== undefined)
      candidates.masters.add(strings[1]);
    const variable = integers[0];
    if (variable === undefined) continue;
    if (code === SET_STRING && strings[0] !== undefined)
      add_candidate(candidates.strings, variable, STRING_BASE, strings[0]);
    if (code === SET_INTEGER && integers[1] !== undefined)
      add_candidate(candidates.integers, variable, INTEGER_BASE, integers[1] >>> 0);
  }
}
