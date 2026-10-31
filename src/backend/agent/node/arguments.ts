/** 只拆参数，不执行 shell 展开。反斜线规则兼顾 Windows 路径与带空格参数。 */
export function split_workspace_command(command: string): string[] {
  const args: string[] = [];
  let value = "";
  let started = false; // 空引号也产生参数，不能只根据 value 是否为空判断。
  let quote = "";
  let quote_position = 0; // 未闭合引号的错误定位到起始位置。
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (char === "\0") throw new Error(`NUL at position ${index}.`);
    if (quote !== "'" && char === "\\") {
      const next = command[index + 1];
      if (
        next !== undefined &&
        (next === "\\" || next === '"' || (quote === "" && (next === "'" || /\s/u.test(next))))
      ) {
        value += next;
        index++;
        started = true;
        continue;
      }
    }
    if (quote !== "") {
      if (char === quote) quote = "";
      else value += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      quote_position = index;
      started = true;
    } else if (/\s/u.test(char)) {
      if (started) args.push(value);
      value = "";
      started = false;
    } else {
      value += char;
      started = true;
    }
  }
  if (quote !== "") throw new Error(`Unclosed quote at position ${quote_position}.`);
  if (started) args.push(value);
  if (args.length === 0) throw new Error("Missing command at position 0.");
  if (args[0] !== "npm") throw new Error("Only the npm command is supported.");
  return args;
}
