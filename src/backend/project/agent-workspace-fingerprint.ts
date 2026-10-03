import { createHash } from "node:crypto";

const FINGERPRINT_RADIX = 36;
const FINGERPRINT_LENGTH = 4;

/** 为工作区对象生成短冲突令牌，调用方负责事实投影与稳定序列化。 */
export function agent_workspace_fingerprint(content: string): string {
  const digest = BigInt(`0x${createHash("sha256").update(content).digest("hex")}`);
  // 固定取低位 Base36 数字并补零，避免变长编码的高位偏斜。
  return digest
    .toString(FINGERPRINT_RADIX)
    .padStart(FINGERPRINT_LENGTH, "0")
    .slice(-FINGERPRINT_LENGTH);
}
