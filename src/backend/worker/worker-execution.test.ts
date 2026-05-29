import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  build_worker_threads_backend_worker_execution_from_desktop_bundle_dir,
  resolve_desktop_bundle_dir_from_module_url,
} from "./worker-execution";

describe("worker-execution", () => {
  it("从动态 chunk 和根入口都解析到桌面 bundle 根目录", () => {
    const bundle_root = path.join(process.cwd(), "build", "dist-electron");

    expect(
      resolve_desktop_bundle_dir_from_module_url(
        pathToFileURL(path.join(bundle_root, "chunks", "backend-bootstrap-demo.js")).toString(),
      ),
    ).toBe(bundle_root);
    expect(
      resolve_desktop_bundle_dir_from_module_url(
        pathToFileURL(path.join(bundle_root, "index.js")).toString(),
      ),
    ).toBe(bundle_root);
  });

  it("把 worker_threads 执行入口固定到桌面 bundle 根目录", () => {
    const bundle_root = path.join(process.cwd(), "build", "dist-electron");
    const execution =
      build_worker_threads_backend_worker_execution_from_desktop_bundle_dir(bundle_root);

    expect(execution).toEqual({
      kind: "worker_threads",
      workUnitWorkerEntryUrl: pathToFileURL(path.join(bundle_root, "work-unit-worker-entry.js")),
      planningWorkerEntryUrl: pathToFileURL(path.join(bundle_root, "planning-worker-entry.js")),
      backendWorkerEntryUrl: pathToFileURL(path.join(bundle_root, "backend-worker-entry.js")),
    });
  });
});
