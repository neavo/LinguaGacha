import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { read_compiled, source_digest } from "./compiled";

it("源码摘要区分通用换行、原始字节与引擎盐值", () => {
  const original = Buffer.from("first\r\nsecond\rthird\n");
  expect(source_digest(original, "universal", "")).toEqual(
    createHash("md5").update("first\nsecond\nthird\n").digest(),
  );
  expect(source_digest(original, "raw", "")).toEqual(createHash("md5").update(original).digest());
  expect(source_digest(original, "raw", "_2025-07-06")).toEqual(
    createHash("md5").update(original).update("_2025-07-06").digest(),
  );
});
it("RPYC 拒绝指向头部或尾部摘要的槽位", async () => {
  for (const start of [10, 46]) {
    const bytes = Buffer.alloc(62);
    bytes.write("RENPY RPC2");
    bytes.writeUInt32LE(1, 10);
    bytes.writeUInt32LE(start, 14);
    bytes.writeUInt32LE(1, 18);
    await expect(read_compiled(bytes)).rejects.toThrow("slot range");
  }
});
