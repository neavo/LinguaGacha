/** `workspace_exec` 可运行的命令及其在运行资源中的 CLI 入口。新增命令只在此登记，时限、监管与回执沿用执行入口。 */
const AGENT_WORKSPACE_COMMANDS: Readonly<Record<string, string>> = Object.freeze({
  npm: "npm/bin/npm-cli.js",
});

export type AgentWorkspaceCommand = Readonly<{ entry: string; args: readonly string[] }>;

/** 只拆参数，不执行 shell 展开。反斜线规则兼顾 Windows 路径与带空格参数，首个参数选择登记命令。 */
export function parse_workspace_command(command: string): AgentWorkspaceCommand {
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
  const [name, ...rest] = args;
  if (name === undefined) throw new Error("Missing command at position 0.");
  const entry = Object.hasOwn(AGENT_WORKSPACE_COMMANDS, name) // 原型链上的键不是登记命令。
    ? AGENT_WORKSPACE_COMMANDS[name]
    : undefined;
  if (entry === undefined)
    throw new Error(
      `Unsupported command "${name}". Available commands: ${Object.keys(AGENT_WORKSPACE_COMMANDS).join(", ")}.`,
    );
  return { entry, args: rest };
}
