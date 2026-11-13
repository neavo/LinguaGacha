import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it, vi } from "vitest";
import { create_image_layout_port } from "./host";
import type { ImageHost, ImageLayoutRequest } from "../../../shared/image";

it("宿主只接收结构化参数并分配工作目录内的输出", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lg-image-port-"));
  try {
    const work = path.join(root, "work");
    await fs.mkdir(work);
    const host = vi.fn<ImageHost>(async () => ({ regions: [] }));
    const call = create_image_layout_port(root, host),
      signal = new AbortController().signal;
    const request: ImageLayoutRequest = {
      kind: "render_image",
      regions: [
        {
          regionId: "text",
          text: "<b>字面文字</b>",
          width: 1,
          height: 1,
          direction: "horizontal-tb",
          style: {},
        },
      ],
    };
    await call(request, signal);
    const [received, receivedSignal] = host.mock.calls[0]!;
    expect(received.regions[0]!.text).toBe(request.regions[0]!.text);
    expect(path.relative(work, received.outputDirectory).startsWith(".." + path.sep)).toBe(false);
    expect(receivedSignal).toBe(signal);
    await expect(call({ ...request, html: "<script>" } as never, signal)).rejects.toThrow(
      "Invalid image layout",
    );
    expect(host).toHaveBeenCalledOnce();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
