import type { ProjectDataRecord } from "../../project/project-data";
import type { CacheFileEntry } from "../cache-types";

export class FileCache {
  private file_entries: CacheFileEntry[] = [];

  public constructor(private readonly before_read: () => void = () => undefined) {}

  public replace(files_block: ProjectDataRecord): void {
    this.file_entries = Object.values(files_block).flatMap((value, index) => {
      if (!this.is_record(value)) {
        return [];
      }
      const rel_path = String(value["rel_path"] ?? "").trim();
      if (rel_path === "") {
        return [];
      }
      return [
        {
          rel_path,
          file_type: String(value["file_type"] ?? "NONE"),
          sort_index: this.read_number(value["sort_index"], index),
        },
      ];
    });
  }

  public clear(): void {
    this.file_entries = [];
  }

  public readFileEntries(): CacheFileEntry[] {
    this.before_read();
    return this.file_entries.map((entry) => ({ ...entry }));
  }

  private is_record(value: unknown): value is ProjectDataRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private read_number(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }
}
