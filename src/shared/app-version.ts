export type AppVersion = Readonly<{
  major: number;
  minor: number;
  patch: number;
  value: string; // 协议与展示共用去除前导零的规范版本。
}>;

/** 工程版本只接受安全整数构成的三段数字，规范值不带展示前缀。 */
export function parse_app_version(value: unknown): AppVersion | null {
  if (typeof value !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(value)) return null;
  const parts = value.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) return null;
  const [major, minor, patch] = parts as [number, number, number];
  return { major, minor, patch, value: parts.join(".") };
}

/** 返回值符号表示左侧版本相对右侧版本的新旧关系。 */
export function compare_app_version(left: AppVersion, right: AppVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}
