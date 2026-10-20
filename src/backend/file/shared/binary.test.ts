import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { read_bytes, write_bytes, copy_range, BINARY_IO_CHUNK_BYTES } from "./binary";

it("范围读写处理短读短写、偏移和截断", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-binary-block-"));
  const source = path.join(temp.path, "source"),
    destination = path.join(temp.path, "output");
  const payload = Buffer.from("short read and write");
  fs.writeFileSync(source, Buffer.concat([Buffer.from("_"), payload]));
  const input = await fs.promises.open(source, "r"),
    output = await fs.promises.open(destination, "wx+");
  const read = input.read.bind(input),
    write = output.write.bind(output);
  Object.assign(input, {
    read: (buffer: Buffer, offset: number, length: number, position: number) =>
      read(buffer, offset, Math.min(length, 3), position),
  });
  Object.assign(output, {
    write: (buffer: Buffer, offset: number, length: number, position: number) =>
      write(buffer, offset, Math.min(length, 2), position),
  });
  try {
    expect((await read_bytes(input, 1, payload.length)).equals(payload)).toBe(true);
    await write_bytes(output, Buffer.from("pre"), 0);
    await write_bytes(output, payload, 3);
    expect(fs.readFileSync(destination).equals(Buffer.concat([Buffer.from("pre"), payload]))).toBe(
      true,
    );
    await expect(read_bytes(input, payload.length, 2)).rejects.toThrow("Truncated");
  } finally {
    await input.close();
    await output.close();
  }
});

it("跨块复制保留完整字节和偏移，块间取消停止后续写入", async () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lg-binary-copy-"));
  const source = path.join(temp.path, "source"),
    destination = path.join(temp.path, "output");
  const payload = Buffer.alloc(BINARY_IO_CHUNK_BYTES + 23).fill(
    Buffer.from(Array.from({ length: 251 }, (_, i) => i)),
  );
  fs.writeFileSync(source, Buffer.concat([Buffer.from("_"), payload]));
  const input = await fs.promises.open(source, "r"),
    output = await fs.promises.open(destination, "wx+");
  const write = output.write.bind(output);
  try {
    await write_bytes(output, Buffer.from("pre"), 0);
    await copy_range(input, output, 1, payload.length, 3);
    expect(fs.readFileSync(destination).equals(Buffer.concat([Buffer.from("pre"), payload]))).toBe(
      true,
    );
    const controller = new AbortController();
    Object.assign(output, {
      write: async (buffer: Buffer, offset: number, length: number, position: number) => {
        const result = await write(buffer, offset, length, position);
        controller.abort(new Error("cancelled between blocks"));
        return result;
      },
    });
    await output.truncate(0);
    await expect(
      copy_range(input, output, 1, payload.length, 0, controller.signal),
    ).rejects.toThrow("cancelled between blocks");
    expect(fs.readFileSync(destination).equals(payload.subarray(0, BINARY_IO_CHUNK_BYTES))).toBe(
      true,
    );
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
