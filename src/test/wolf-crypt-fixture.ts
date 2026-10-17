import { inflateRawSync } from "node:zlib";

export function wolf_vector(encoded: string): Buffer {
  return inflateRawSync(Buffer.from(encoded, "base64"));
}
