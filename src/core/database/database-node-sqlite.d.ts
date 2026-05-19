declare module "node:sqlite" {
  // Electron 当前 runtime 已提供 node:sqlite，但 TypeScript 类型尚未稳定发布
  export interface StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number | bigint };
  }

  export class DatabaseSync {
    public constructor(path: string);
    public close(): void;
    public exec(sql: string): void;
    public prepare(sql: string): StatementSync;
  }
}
