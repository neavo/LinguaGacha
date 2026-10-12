import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { read_bytes, write_bytes, copy_range } from "./binary";

it("短读和短写仍完整复制指定范围，文件提前结束时失败", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-binary-"));
  const source = path.join(temp.path, "source"),
    destination = path.join(temp.path, "output");
  fs.writeFileSync(source, "_payload_");
  const input = await fs.promises.open(source, "r"),
    output = await fs.promises.open(destination, "wx+");
  const read = input.read.bind(input),
    write = output.write.bind(output);
  // 保留真实文件和句柄，只限制单次 IO 的长度，模拟操作系统允许的短读与短写。
  Object.assign(input, {
    read: (buffer: Buffer, offset: number, length: number, position: number) =>
      read(buffer, offset, Math.min(length, 2), position),
  });
  Object.assign(output, {
    write: (buffer: Buffer, offset: number, length: number, position: number) =>
      write(buffer, offset, Math.min(length, 2), position),
  });
  try {
    expect(await read_bytes(input, 1, 7)).toEqual(Buffer.from("payload"));
    await write_bytes(output, Buffer.from("--"), 0);
    await copy_range(input, output, 1, 7, 2);
    expect(fs.readFileSync(destination, "utf8")).toBe("--payload");
    await expect(read_bytes(input, 8, 2)).rejects.toThrow("Truncated");
  } finally {
    await input.close();
    await output.close();
  }
});

it("零进展写入和预先取消在落盘前失败", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-binary-stop-"));
  const source = path.join(temp.path, "source"),
    destination = path.join(temp.path, "output");
  fs.writeFileSync(source, "payload");
  const input = await fs.promises.open(source, "r"),
    output = await fs.promises.open(destination, "wx+");
  Object.assign(output, { write: async (buffer: Buffer) => ({ bytesWritten: 0, buffer }) });
  try {
    await expect(write_bytes(output, Buffer.from("data"), 0)).rejects.toThrow("Failed to write");
    await expect(
      copy_range(input, output, 0, 7, 0, AbortSignal.abort(new Error("cancelled"))),
    ).rejects.toThrow("cancelled");
    expect(fs.statSync(destination).size).toBe(0);
  } finally {
    await input.close();
    await output.close();
  }
});
