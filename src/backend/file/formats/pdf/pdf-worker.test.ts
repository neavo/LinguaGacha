import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, afterAll, expect, it } from "vitest";
import { PDFWorker } from "./pdf-worker";
import { resolve_workspace_runtime_entry } from "../../../../native/workspace-runtime";
import { create_pdf_fixture } from "./test-support";
import type { PDFDocument } from "../../../../shared/pdf";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "lg-pdf-worker-"));
  const deployed = process.env.LINGUAGACHA_TEST_WORKSPACE_RUNTIME;
  if (deployed) await cp(deployed, directory, { recursive: true });
  else
    execFileSync(process.execPath, ["buildtools/build-workspace.mjs", directory], {
      windowsHide: true,
      stdio: "pipe",
    });
}, 60_000);
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

it("独立部署线程读取、打印回调与合并共用同一引擎，取消收尾后队列可继续", async () => {
  let cancel_print = false;
  let notify_print: () => void;
  const entered = new Promise<void>((resolve) => {
    notify_print = resolve;
  });
  let print_stopped = false;
  const worker = new PDFWorker(
    pathToFileURL(resolve_workspace_runtime_entry(directory, "@lg/pdf/worker")),
    async (_operation, signal) => {
      if (!cancel_print) return create_pdf_fixture(["Translated"]);
      notify_print();
      return await new Promise<Uint8Array>((_resolve, reject) => {
        signal!.addEventListener(
          "abort",
          () => {
            print_stopped = true;
            reject(signal!.reason);
          },
          { once: true },
        );
      });
    },
  );
  try {
    const bytes = create_pdf_fixture();
    const document = (await worker.run({ kind: "read", bytes })) as PDFDocument;
    expect(document.pages).toHaveLength(3);
    document.pages[0]!.translation = { kind: "translate", markdown: "# Translation" };
    document.pages[1]!.translation = { kind: "translate", markdown: "" };
    const task = { kind: "build" as const, title: "test", document, bytes };
    const result = await worker.run(task);
    expect(result).toBeInstanceOf(Uint8Array);
    const rebuilt = (await worker.run({
      kind: "read",
      bytes: result as Uint8Array,
    })) as PDFDocument;
    expect(rebuilt.pages).toHaveLength(2);
    const preview = await worker.run({
      kind: "preview",
      title: "preview",
      document,
      bytes,
      page: 1,
    });
    expect(preview).toBeInstanceOf(Uint8Array);
    const image = await worker.run({ kind: "render", bytes: preview as Uint8Array, page: 1 });
    expect(image).toMatchObject({
      count: 1,
      page: 1,
      image: expect.stringMatching(/^data:image\/png;base64,/),
    });
    cancel_print = true;
    const controller = new AbortController();
    const cancelled = worker.run(task, controller.signal);
    const rejected = expect(cancelled).rejects.toThrow();
    await entered;
    controller.abort();
    await rejected;
    expect(print_stopped).toBe(true);
    expect(((await worker.run({ kind: "read", bytes })) as PDFDocument).pages).toHaveLength(3);
  } finally {
    await worker.dispose();
  }
  await expect(worker.run({ kind: "read", bytes: create_pdf_fixture() })).rejects.toThrow();
});
