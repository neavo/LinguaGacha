import { createHash } from "node:crypto";
import { read_compiled, type CompiledSlot } from "./compiled";
import type { PickleNode } from "./pickle";
import {
  script_codes,
  script_consumers,
  script_excluded,
  script_identities,
  type RenpyCode,
  type RenpyConsumers,
} from "./script";

/** 条目身份绑定的成员摘要。导出在建立编译图之前即可核对。 */
export const member_digest = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * 当前成员的完整编译图与结构索引，供提取、投影和写回共用。
 * 由成员调用栈拥有，成员处理结束后随之释放，不进入跨成员摘要。
 */
export type RenpyMember = Readonly<{
  bytes: Buffer;
  slots: readonly CompiledSlot[];
  python2: boolean;
  excluded: ReadonlySet<PickleNode>; // 其他语言子图，不提供基础语言身份或候选。
  identities: ReadonlyMap<PickleNode, string>;
  codes: readonly RenpyCode[];
  consumers(slot: CompiledSlot, signal?: AbortSignal): Promise<RenpyConsumers>;
}>;

/** 一次读取完整编译数据，并建立提取与写回共同依赖的身份和代码记录。 */
export async function read_member(
  input: Uint8Array,
  python2: boolean,
  signal?: AbortSignal,
): Promise<RenpyMember> {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const slots = await read_compiled(bytes, signal);
  const excluded = await script_excluded(slots, signal);
  const identities = await script_identities(slots, excluded, signal);
  const consumers = new Map<CompiledSlot, RenpyConsumers>();
  return {
    bytes,
    slots,
    python2,
    excluded,
    identities,
    codes: await script_codes({ slots }, identities, signal),
    /** 提取与写回共用槽位索引，加载分析无需提前建立它。 */
    async consumers(slot, signal) {
      let index = consumers.get(slot);
      if (!index)
        consumers.set(slot, (index = await script_consumers(slot.graph.root, identities, signal)));
      return index;
    },
  };
}
