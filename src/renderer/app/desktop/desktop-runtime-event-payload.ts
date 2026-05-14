import {
  isProjectStoreStage,
  type ProjectStoreSectionRevisions,
} from "@/project/store/project-store";
import { JsonTool } from "../../../shared/utils/json-tool";

export function parse_event_payload(event: MessageEvent<string>): Record<string, unknown> {
  try {
    return JsonTool.parseStrict<Record<string, unknown>>(event.data);
  } catch {
    return {};
  }
}

export function normalize_string_array(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry ?? "").trim()).filter((entry) => entry !== "");
}

export function normalize_section_array(value: unknown): string[] {
  return normalize_string_array(value);
}

export function normalize_section_revisions(
  value: unknown,
): ProjectStoreSectionRevisions | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const raw_entries = Object.entries(value as Record<string, unknown>);
  const section_revisions: Record<string, number> = {};
  for (const [section, revision] of raw_entries) {
    if (!isProjectStoreStage(section)) {
      continue;
    }

    const normalized_revision = Number(revision);
    if (!Number.isFinite(normalized_revision)) {
      continue;
    }

    section_revisions[section] = normalized_revision;
  }

  if (Object.keys(section_revisions).length === 0) {
    return undefined;
  }

  return section_revisions;
}
