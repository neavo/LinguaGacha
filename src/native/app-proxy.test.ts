import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "vite";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { configure_app_proxy } from "./app-proxy";

const { set_proxy } = vi.hoisted(() => ({ set_proxy: vi.fn() }));
vi.mock("electron", () => ({ session: { defaultSession: { setProxy: set_proxy } } }));

beforeEach(() => {
  set_proxy.mockReset().mockResolvedValue(undefined);
});

describe("configure_app_proxy", () => {
  it.each([undefined, "", " \t\n"])("空配置 %j 沿用默认 Session 策略", async (value) => {
    vi.stubEnv("LG_PROXY", value);
    await configure_app_proxy();
    expect(set_proxy).not.toHaveBeenCalled();
  });

  // 标准端口与主机规范化属于跨网络栈契约，需要独立预期。
  it.each([
    ["http://proxy.test", "http://proxy.test:80"],
    ["https://proxy.test/", "https://proxy.test:443"],
    ["socks5://proxy.test", "socks5://proxy.test:1080"],
    ["socks5://%70ROXY.test", "socks5://proxy.test:1080"],
    ["socks5://代理.test", "socks5://xn--mnq481g.test:1080"],
    ["  HTTP://PROXY.TEST:7890/  ", "http://proxy.test:7890"],
    ["http://[::1]:7890", "http://[::1]:7890"],
    ["socks5://[2001:db8::1]", "socks5://[2001:db8::1]:1080"],
  ])("%s 配置明确的 Chromium 规则", async (value, rules) => {
    vi.stubEnv("LG_PROXY", value);
    await configure_app_proxy();
    expect(set_proxy).toHaveBeenCalledExactlyOnceWith({
      mode: "fixed_servers",
      proxyRules: rules,
      proxyBypassRules: "localhost;127.0.0.0/8;[::1]",
    });
  });

  it.each([
    ["proxy.test:7890", "proxy URL"],
    ["http:proxy.test", "proxy URL"],
    ["http:///proxy.test", "path"],
    ["http://", "host"],
    ["socks5://", "host"],
    ["http://proxy.test:invalid", "port"],
    ["http://proxy.test:65536", "port"],
    ["http://proxy.test;direct", "host"],
    ["http://proxy.test,other.test", "host"],
    ["http://proxy.test%3Bdirect", "host"],
    ["socks5://%3BDIRECT%3B", "host"],
    ["socks5://proxy.test%2Cother.test", "host"],
    ["socks5://proxy.test%3DDIRECT", "host"],
    ["socks5://proxy.test%2Fpath", "host"],
    ["socks5://%253BDIRECT%253B", "host"],
    ["socks4://proxy.test", "supports only"],
    ["http://user:secret@proxy.test", "username or password"],
    ["http://@proxy.test", "username or password"],
    ["http://proxy.test/path", "path"],
    ["http://proxy.test/path/..", "path"],
    ["http://proxy.test?", "query or fragment"],
    ["http://proxy.test#", "query or fragment"],
    ["http://proxy.test\n:80", "proxy URL"],
    ["http://proxy.test\\path", "proxy URL"],
  ])("拒绝 %s 并说明原因", async (value, reason) => {
    vi.stubEnv("LG_PROXY", value);
    await expect(configure_app_proxy()).rejects.toThrow(new RegExp(`LG_PROXY.*${reason}`, "u"));
    expect(set_proxy).not.toHaveBeenCalled();
  });

  it("URL 解析错误不暴露输入中的凭据", async () => {
    vi.stubEnv("LG_PROXY", "http://private-user:private-secret@proxy.test:invalid");
    const error = await configure_app_proxy().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("LG_PROXY");
    expect(String(error)).not.toMatch(/private-user|private-secret|proxy.test/u);
    expect((error as Error).cause).toBeUndefined();
  });

  it("Session 配置失败向启动入口传播", async () => {
    vi.stubEnv("LG_PROXY", "http://proxy.test");
    const error = new Error("session configuration failed");
    set_proxy.mockRejectedValueOnce(error);
    await expect(configure_app_proxy()).rejects.toBe(error);
  });
});

// Node 单测使用 Session 替身，真实代理协议在独立 Electron 进程中验证。
it("真实 Electron Session 与 Undici 共用应用代理，回环固定直连", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linguagacha-app-proxy-"));
  try {
    await fs.symlink(
      path.resolve("node_modules"),
      path.join(directory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await build({
      configFile: false,
      logLevel: "silent",
      build: {
        outDir: path.join(directory, "bundle"),
        lib: {
          entry: {
            configuration: path.resolve("src/native/app-proxy.ts"),
            client: path.resolve("src/backend/network/proxy-http-client.ts"),
          },
          formats: ["es"],
          fileName: (_format, name) => `${name}.mjs`,
        },
        rolldownOptions: { external: ["electron", "undici", /^node:/u], platform: "node" },
        minify: false,
      },
    });
    const entry = path.join(directory, "main.mjs");
    await fs.writeFile(
      entry,
      `
import { app, session } from 'electron';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { configure_app_proxy } from ${JSON.stringify(pathToFileURL(path.join(directory, "bundle/configuration.mjs")).href)};
import { ProxyHttpClient } from ${JSON.stringify(pathToFileURL(path.join(directory, "bundle/client.mjs")).href)};
app.commandLine.appendSwitch('disable-gpu');
void (async () => {
  await app.whenReady();
  const requests = [];
  const origin = http.createServer((request, response) => response.end('origin:' + request.url));
  const proxy = http.createServer((request, response) => {
    requests.push(request.url);
    response.end('origin:' + new URL(request.url).pathname);
  });
  const client = new ProxyHttpClient({resolveProxy: url => session.defaultSession.resolveProxy(url)});
  try {
    origin.listen(0);
    await once(origin, 'listening');
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    for (const [value, route] of [
      ['http://proxy.invalid', 'PROXY proxy.invalid:80'],
      ['https://proxy.invalid', 'HTTPS proxy.invalid:443'],
      ['socks5://proxy.invalid', 'SOCKS5 proxy.invalid:1080'],
      ['socks5://%70ROXY.invalid', 'SOCKS5 proxy.invalid:1080'],
      ['http://[::1]:7890', 'PROXY [::1]:7890'],
    ]) {
      process.env.LG_PROXY = value;
      await configure_app_proxy();
      assert.equal(await session.defaultSession.resolveProxy('https://target.invalid'), route);
    }
    process.env.LG_PROXY = 'socks5://%3BDIRECT%3B';
    await assert.rejects(configure_app_proxy(), /LG_PROXY.*host/);
    assert.equal(await session.defaultSession.resolveProxy('https://target.invalid'), 'PROXY [::1]:7890');
    process.env.LG_PROXY = 'http://127.0.0.1:' + proxy.address().port;
    await configure_app_proxy();
    assert.equal(await (await session.defaultSession.fetch('http://proxy-fixture.invalid/chromium')).text(), 'origin:/chromium');
    assert.equal(await (await client.fetch('http://proxy-fixture.invalid/undici', {signal: AbortSignal.timeout(5000)})).text(), 'origin:/undici');
    assert.deepEqual(requests, ['http://proxy-fixture.invalid/chromium', 'http://proxy-fixture.invalid/undici']);
    for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]']) {
      const url = 'http://' + host + ':' + origin.address().port + '/loopback';
      assert.equal(await session.defaultSession.resolveProxy(url), 'DIRECT');
      assert.equal(await (await session.defaultSession.fetch(url)).text(), 'origin:/loopback');
      assert.equal(await (await client.fetch(url, {signal: AbortSignal.timeout(5000)})).text(), 'origin:/loopback');
    }
    assert.equal(requests.length, 2);
    // 空配置保留现有 Session 策略，关闭代理后验证请求失败。
    process.env.LG_PROXY = '  ';
    await configure_app_proxy();
    assert.equal(await session.defaultSession.resolveProxy('http://target.invalid'), 'PROXY 127.0.0.1:' + proxy.address().port);
    await session.defaultSession.closeAllConnections();
    proxy.closeAllConnections();
    await new Promise(resolve => proxy.close(resolve));
    await assert.rejects(session.defaultSession.fetch('http://proxy-fixture.invalid/unavailable', {signal: AbortSignal.timeout(5000)}));
    await assert.rejects(client.fetch('http://proxy-fixture.invalid/unavailable', {signal: AbortSignal.timeout(5000)}));
    console.log('app-proxy-ok');
  } finally {
    await client.dispose();
    await session.defaultSession.closeAllConnections();
    proxy.closeAllConnections();
    origin.closeAllConnections();
    await Promise.all([proxy.listening ? new Promise(resolve => proxy.close(resolve)) : undefined, new Promise(resolve => origin.close(resolve))]);
  }
})().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
`,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.LG_PROXY;
    const executable = createRequire(import.meta.url)("electron") as string;
    const result = await promisify(execFile)(
      executable,
      [entry, `--user-data-dir=${path.join(directory, "profile")}`],
      { env, timeout: 30_000, windowsHide: true },
    );
    expect(result.stdout).toContain("app-proxy-ok");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 40_000);
