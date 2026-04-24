import { describe, expect, it } from "vitest";

import { createProjectStore } from "./project-store";
import { createProjectBootstrapLoader } from "./project-bootstrap-loader";

describe("createProjectBootstrapLoader", () => {
  it("把 row block bootstrap 解码后写入 store", async () => {
    const store = createProjectStore();
    const runtime = createProjectBootstrapLoader({
      store,
      openBootstrapStream: async function* () {
        yield {
          type: "stage_payload",
          stage: "items",
          payload: {
            fields: ["item_id", "file_path", "src", "dst", "status"],
            rows: [[1, "chapter01.txt", "原文", "译文", "DONE"]],
          },
        };
        yield {
          type: "completed",
          projectRevision: 3,
          sectionRevisions: {
            items: 3,
          },
        };
      },
    });

    await runtime.bootstrap("E:/demo/demo.lg");

    expect(store.getState().items["1"]).toEqual({
      item_id: 1,
      file_path: "chapter01.txt",
      src: "原文",
      dst: "译文",
      status: "DONE",
    });
    expect(store.getState().revisions.projectRevision).toBe(3);
    expect(store.getState().revisions.sections.items).toBe(3);
  });
});
