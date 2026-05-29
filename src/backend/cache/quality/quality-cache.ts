import type { ProjectDataRecord } from "../../project/project-data";

export class QualityCache {
  private block: ProjectDataRecord = {};

  public constructor(private readonly before_read: () => void = () => undefined) {}

  public replace(block: ProjectDataRecord): void {
    this.block = { ...block };
  }

  public clear(): void {
    this.block = {};
  }

  public readBlock(): ProjectDataRecord {
    this.before_read();
    return { ...this.block };
  }

  public readQualityCheck(item_id: number): ProjectDataRecord {
    this.before_read();
    return {
      item_id,
      warnings: [],
      warning_fragments_by_code: {},
    };
  }
}
