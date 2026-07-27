import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectDatabase } from "../database/database-operations";
import { adapt_project_change } from "./project-write-event-adapter";
import { ProjectSessionState } from "./project-session-state";

describe("adapt_project_change", () => {
  const cleanup_paths: string[] = [];
  const cleanup_databases: ProjectDatabase[] = [];

  afterEach(() => {
    while (cleanup_databases.length > 0) {
      cleanup_databases.pop()?.close();
    }
    while (cleanup_paths.length > 0) {
      fs.rmSync(cleanup_paths.pop() ?? "", { recursive: true, force: true });
    }
  });

  it("为 loaded 工程补齐行级失效与小 section canonical payload", () => {
    const { database, project_path, session_state } = create_project();
    database.set_meta(project_path, "project_runtime_revision.items", 2);
    database.set_meta(project_path, "project_runtime_revision.analysis", 3);
    database.set_meta(project_path, "analysis_candidate_count", 4);

    const event = adapt_project_change(database, session_state, {
      projectPath: project_path,
      source: "test",
      updatedSections: ["items", "analysis"],
    });

    expect(event).toMatchObject({
      source: "test",
      projectPath: project_path,
      projectRevision: 3,
      sectionRevisions: { items: 2, analysis: 3 },
      items: { payloadMode: "section-invalidated" },
      sections: {
        analysis: {
          payloadMode: "canonical-delta",
          data: expect.objectContaining({ candidate_count: 4 }),
        },
      },
    });
  });

  it("canonical item delta 按 changedIds 回读公开行", () => {
    const { database, project_path, session_state } = create_project();
    database.set_items(project_path, [
      {
        id: 1,
        src: "原文",
        dst: "译文",
        name_src: null,
        name_dst: null,
        extra_field: "",
        tag: "",
        row: 0,
        file_path: "script.txt",
        file_type: "TXT",
        text_type: "NONE",
        status: "PROCESSED",
        retry_count: 0,
        skip_internal_filter: false,
      },
    ]);

    const event = adapt_project_change(database, session_state, {
      projectPath: project_path,
      source: "test",
      updatedSections: ["items"],
      items: { payloadMode: "canonical-delta", changedIds: [1] },
    });

    expect(event?.items).toMatchObject({
      payloadMode: "canonical-delta",
      changedIds: [1],
      upsert: { "1": { item_id: 1, src: "原文", dst: "译文" } },
    });
  });

  it("目标不是当前 loaded 工程时不生成公开事件", () => {
    const { database, project_path, session_state } = create_project();
    session_state.clear();

    expect(
      adapt_project_change(database, session_state, {
        projectPath: project_path,
        source: "test",
        updatedSections: ["items"],
      }),
    ).toBeNull();
  });

  function create_project(): {
    database: ProjectDatabase;
    project_path: string;
    session_state: ProjectSessionState;
  } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-change-adapter-"));
    cleanup_paths.push(directory);
    const project_path = path.join(directory, "project.lg");
    const database = new ProjectDatabase();
    cleanup_databases.push(database);
    database.create_project(project_path, "demo");
    const session_state = new ProjectSessionState();
    session_state.mark_loaded(project_path);
    return { database, project_path, session_state };
  }
});
