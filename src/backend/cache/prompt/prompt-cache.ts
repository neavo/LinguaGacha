import type { ProjectDataRecord } from "../../project/project-data";

export class PromptCache {
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
}
