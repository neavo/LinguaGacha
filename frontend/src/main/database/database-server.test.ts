import http from "node:http";

import { describe, expect, it } from "vitest";

import { JsonTool } from "../../utils/json-tool";
import { DatabaseServer } from "./database-server";

function request_database_health(
  base_url: string,
  token: string,
): Promise<{
  statusCode: number;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      `${base_url}/internal/database/health`,
      {
        headers: { "X-LinguaGacha-Database-Token": token },
        method: "GET",
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("DatabaseServer", () => {
  it("校验 token 并提供统一 JSON 响应壳", async () => {
    const server = new DatabaseServer();
    const start_result = await server.start();

    try {
      const unauthorized = await request_database_health(start_result.baseUrl, "bad");
      expect(unauthorized.statusCode).toBe(401);

      const ok = await request_database_health(start_result.baseUrl, start_result.token);
      expect(JsonTool.parseStrict(ok.body)).toEqual({ ok: true, data: { status: "ok" } });
    } finally {
      await server.stop();
    }
  });
});
