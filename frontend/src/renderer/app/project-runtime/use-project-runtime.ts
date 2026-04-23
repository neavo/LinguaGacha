import { consumeBootstrapStream, type BootstrapStreamEvent } from "./bootstrap-stream";
import {
  type ProjectStoreBootstrapPayload,
  type ProjectStoreStage,
  isProjectStoreStage,
} from "./project-store";

type ProjectStoreApi = {
  applyBootstrapStage: (stage: ProjectStoreStage, payload: ProjectStoreBootstrapPayload) => void;
};

type ProjectRuntimeArgs = {
  store: ProjectStoreApi;
  openBootstrapStream: () => AsyncIterable<BootstrapStreamEvent>;
};

export function createProjectRuntime(args: ProjectRuntimeArgs) {
  function isRowBlockPayload(payload: Record<string, unknown>): payload is {
    fields: string[];
    rows: unknown[][];
  } {
    return Array.isArray(payload.fields) && Array.isArray(payload.rows);
  }

  function buildRecordMapFromRowBlock(
    payload: {
      fields: string[];
      rows: unknown[][];
    },
    keyField: string,
  ): Record<string, Record<string, unknown>> {
    const records: Record<string, Record<string, unknown>> = {};

    for (const row of payload.rows) {
      if (!Array.isArray(row)) {
        continue;
      }

      const record: Record<string, unknown> = {};
      payload.fields.forEach((field, index) => {
        record[field] = row[index];
      });

      const recordKey = String(record[keyField] ?? "").trim();
      if (recordKey === "") {
        continue;
      }

      records[recordKey] = record;
    }

    return records;
  }

  function normalizeStagePayload(
    stage: ProjectStoreStage,
    payload: Record<string, unknown>,
  ): ProjectStoreBootstrapPayload {
    if (stage === "items" && isRowBlockPayload(payload)) {
      return {
        items: buildRecordMapFromRowBlock(payload, "item_id"),
      };
    }

    if (stage === "files" && isRowBlockPayload(payload)) {
      return {
        files: buildRecordMapFromRowBlock(payload, "rel_path"),
      };
    }

    if (stage === "quality") {
      return {
        quality: payload as ProjectStoreBootstrapPayload["quality"],
      };
    }

    if (stage === "prompts") {
      return {
        prompts: payload as ProjectStoreBootstrapPayload["prompts"],
      };
    }

    if (stage === "analysis") {
      return {
        analysis: payload,
      };
    }

    if (stage === "proofreading") {
      return {
        proofreading: payload as ProjectStoreBootstrapPayload["proofreading"],
      };
    }

    if (stage === "task") {
      return {
        task: payload,
      };
    }

    return payload as ProjectStoreBootstrapPayload;
  }

  return {
    async bootstrap(
      projectPath: string,
      options: {
        onStageStarted?: (stage: ProjectStoreStage) => void;
      } = {},
    ): Promise<void> {
      const normalized_project_path = projectPath.trim();
      if (normalized_project_path === "") {
        return;
      }

      await consumeBootstrapStream({
        open: () => args.openBootstrapStream(),
        onStageStarted: (stage) => {
          if (!isProjectStoreStage(stage)) {
            return;
          }

          options.onStageStarted?.(stage);
        },
        onStagePayload: (stage, payload) => {
          if (!isProjectStoreStage(stage)) {
            return;
          }

          args.store.applyBootstrapStage(stage, normalizeStagePayload(stage, payload));
        },
        onCompleted: (projectRevision, sectionRevisions) => {
          args.store.applyBootstrapStage("project", {
            revisions: {
              projectRevision,
              sections: sectionRevisions,
            },
          });
        },
      });
    },
  };
}
