import { describe, expect, it } from "vitest";
import { AppError } from "../../shared/error";
import { database_error } from "./database-error";

describe("database_error", () => {
  it("扩展忙码保留原码，内部锁错误保留故障语义", () => {
    for (const [errcode, code] of [
      [5, "database.busy"],
      [517, "database.busy"],
      [6, "runtime.internal_invariant"],
    ] as const) {
      const cause = Object.assign(new Error("sqlite failure"), { errcode });
      expect(database_error(cause, "/private/project.lg", "journal_mode")).toMatchObject({
        code,
        cause,
        diagnostic_context: {
          operation: "journal_mode",
          sqlite_code: errcode,
          project: { basename: "project.lg" },
        },
      });
    }
  });

  it("已有业务错误保持身份，普通异常不按消息猜测锁冲突", () => {
    const expected = new AppError("request.validation_failed");
    expect(database_error(expected, "project.lg", "operation")).toBe(expected);
    expect(database_error(new Error("database is locked"), "project.lg", "operation").code).toBe(
      "runtime.internal_invariant",
    );
  });
});
