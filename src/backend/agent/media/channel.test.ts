import { expect, it } from "vitest";
import {
  CHANNEL_HEADER_MAX,
  CHANNEL_PAYLOAD_MAX,
  encode_frame,
  FrameReader,
  tensor_shape,
} from "./channel";

const bytes = (frames: Buffer[]): Buffer => Buffer.concat(frames);

it("reassembles frames regardless of chunk boundaries", () => {
  const tensor = new Float32Array([1.5, -2, 3]);
  const stream = Buffer.concat([
    bytes(encode_frame({ id: 1, kind: "det" }, new Uint8Array(tensor.buffer))),
    bytes(encode_frame({ result: true })),
    bytes(encode_frame({ id: 2 }, new Uint8Array([7]))),
  ]);
  for (const size of [1, 3, 7, stream.length]) {
    const reader = new FrameReader();
    const frames = [];
    for (let offset = 0; offset < stream.length; offset += size)
      frames.push(...reader.push(stream.subarray(offset, offset + size)));
    reader.end();
    expect(frames.map((frame) => frame.header)).toEqual([
      { id: 1, kind: "det", bytes: 12 },
      { result: true, bytes: 0 },
      { id: 2, bytes: 1 },
    ]);
    expect(Array.from(new Float32Array(frames[0]!.payload.buffer))).toEqual([1.5, -2, 3]);
    // 每个载荷独占自己的缓冲区，转移给 Worker 不会带走其它帧的数据。
    expect(frames[0]!.payload.buffer.byteLength).toBe(12);
    expect(frames[2]!.payload.buffer.byteLength).toBe(1);
  }
});

it("reports truncated output instead of treating it as empty", () => {
  const frame = bytes(encode_frame({ id: 1 }, new Uint8Array([1, 2, 3])));
  const reader = new FrameReader();
  expect(reader.push(frame.subarray(0, frame.length - 1))).toEqual([]);
  expect(() => reader.end()).toThrow("truncated");
});

it("rejects oversized headers and payload sizes", () => {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(CHANNEL_HEADER_MAX + 1);
  expect(() => new FrameReader().push(prefix)).toThrow("too long");
  for (const size of [-1, 1.5, CHANNEL_PAYLOAD_MAX + 1]) {
    const head = Buffer.from(JSON.stringify({ bytes: size }));
    const length = Buffer.alloc(4);
    length.writeUInt32LE(head.length);
    expect(() => new FrameReader().push(Buffer.concat([length, head]))).toThrow("payload size");
  }
});

it("accepts only float32 tensors whose shape matches the payload", () => {
  expect(tensor_shape({ dtype: "float32", shape: [2, 3] }, 24)).toEqual([2, 3]);
  expect(() => tensor_shape({ dtype: "float32", shape: [2, 3] }, 20)).toThrow();
  expect(() => tensor_shape({ dtype: "float64", shape: [3] }, 24)).toThrow();
  expect(() => tensor_shape({ dtype: "float32", shape: [0, 3] }, 0)).toThrow();
  expect(() => tensor_shape({ dtype: "float32", shape: "3" }, 12)).toThrow();
});
