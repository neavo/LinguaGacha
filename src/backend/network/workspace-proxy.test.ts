import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceProxy } from "./workspace-proxy";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function listen(server: net.Server): Promise<number> {
  const sockets = new Set<net.Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Invalid test address");
  return address.port;
}

async function proxy(resolveProxy: (url: string) => Promise<string>) {
  const value = await WorkspaceProxy.start({ resolveProxy });
  cleanups.push(() => value.close());
  return value;
}

function authorization(url: string) {
  const target = new URL(url);
  return `Basic ${Buffer.from(`${target.username}:${target.password}`).toString("base64")}`;
}

async function request(proxy: WorkspaceProxy, target: string, auth = authorization(proxy.url)) {
  return await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const outgoing = http.request(
      proxy.url,
      { path: target, headers: { "proxy-authorization": auth, authorization: "Bearer target" } },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => {
          body += chunk;
        });
        incoming.on("end", () => resolve({ status: incoming.statusCode!, body }));
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

async function tunnel(proxy: WorkspaceProxy, target: string): Promise<Duplex> {
  return await new Promise((resolve, reject) => {
    const outgoing = http.request(proxy.url, {
      method: "CONNECT",
      path: target,
      headers: { "proxy-authorization": authorization(proxy.url) },
    });
    outgoing.once("error", reject);
    outgoing.once("connect", (response, socket) =>
      response.statusCode === 200
        ? resolve(socket)
        : reject(new Error(`CONNECT ${response.statusCode}`)),
    );
    outgoing.end();
  });
}

it("HTTP 默认转发采用应用路由，隔离本机认证与目标认证，解析失败不直连", async () => {
  const received: http.IncomingMessage[] = [];
  const upstream = http.createServer((request, response) => {
    received.push(request);
    response.end("proxied");
  });
  const port = await listen(upstream);
  const resolver = vi.fn(async () => `PROXY user:secret@127.0.0.1:${port}`);
  const local = await proxy(resolver);
  expect((await request(local, "http://npm.example/pkg", "invalid")).status).toBe(407);
  expect(resolver).not.toHaveBeenCalled();
  expect(await request(local, "http://npm.example/pkg")).toEqual({ status: 200, body: "proxied" });
  expect(received[0]!.url).toBe("http://npm.example/pkg");
  expect(received[0]!.headers["proxy-authorization"]).toBe(
    `Basic ${Buffer.from("user:secret").toString("base64")}`,
  );
  expect(received[0]!.headers.authorization).toBe("Bearer target");
  const failed = await proxy(async () => {
    throw new Error("route unavailable");
  });
  expect((await request(failed, "http://npm.example/pkg")).status).toBe(502);
  expect(received).toHaveLength(1);
});

it("CONNECT 支持回环直连、HTTP 上游认证和取消中的隧道关闭", async () => {
  const echo_port = await listen(net.createServer((socket) => socket.pipe(socket)));
  const direct = await proxy(async () => {
    throw new Error("loopback must be direct");
  });
  const direct_socket = await tunnel(direct, `127.0.0.1:${echo_port}`);
  const reply = new Promise<string>((resolve) =>
    direct_socket.once("data", (chunk: Buffer) => resolve(chunk.toString())),
  );
  direct_socket.write("hello");
  expect(await reply).toBe("hello");
  direct_socket.destroy();
  let upstream_auth: string | undefined;
  const upstream = http.createServer();
  upstream.on("connect", (incoming, socket, head) => {
    upstream_auth = incoming.headers["proxy-authorization"];
    const target = net.createConnection({ host: "127.0.0.1", port: echo_port }, () => {
      socket.write("HTTP/1.1 200 OK\r\n\r\n");
      if (head.length) target.write(head);
      socket.pipe(target).pipe(socket);
    });
    target.on("error", () => socket.destroy());
    socket.once("close", () => target.destroy());
  });
  const port = await listen(upstream);
  const local = await WorkspaceProxy.start({
    resolveProxy: async () => `PROXY user:secret@127.0.0.1:${port}`,
  });
  try {
    const socket = await tunnel(local, "npm.example:443");
    const data = new Promise<string>((resolve) =>
      socket.once("data", (chunk: Buffer) => resolve(chunk.toString())),
    );
    socket.write("tunnel");
    expect(await data).toBe("tunnel");
    expect(upstream_auth).toBe(`Basic ${Buffer.from("user:secret").toString("base64")}`);
    const closed = new Promise<void>((resolve) => {
      socket.on("error", () => {});
      socket.once("close", () => resolve());
    });
    await local.close();
    await closed;
  } catch (error) {
    await local.close();
    throw error;
  }
});

it("HTTPS 上游以 TLS 连接代理，SNI 不沿用 CONNECT 目标", async () => {
  let resolve_hello!: (chunk: Buffer) => void;
  const hello = new Promise<Buffer>((resolve) => (resolve_hello = resolve));
  const upstream = net.createServer((socket) =>
    socket.once("data", (chunk: Buffer) => {
      resolve_hello(chunk);
      socket.destroy();
    }),
  );
  const port = await listen(upstream);
  const local = await proxy(async () => `HTTPS 127.0.0.1:${port}`);
  await expect(tunnel(local, "npm.example:443")).rejects.toThrow();
  const chunk = await hello;
  expect(chunk[0]).toBe(0x16); // TLS 握手记录，说明代理凭据不会明文发出。
  expect(chunk.includes("npm.example")).toBe(false); // Node 默认取 Host 头作 SNI，即 CONNECT 目标。
});

it("SOCKS5 上游经公开客户端完成 CONNECT 并随操作关闭", async () => {
  const destinations: string[] = [];
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let greeted = false;
    let connected = false;
    socket.on("data", (chunk) => {
      if (connected) {
        socket.write(chunk);
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      if (!greeted) {
        if (buffer.length < 2 || buffer.length < buffer[1]! + 2) return;
        buffer = buffer.subarray(buffer[1]! + 2);
        greeted = true;
        socket.write(Buffer.from([5, 0]));
      }
      if (buffer.length < 5 || buffer.length < buffer[4]! + 7) return;
      destinations.push(buffer.subarray(5, 5 + buffer[4]!).toString());
      connected = true;
      socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
    });
  });
  const port = await listen(server);
  const local = await proxy(async () => `SOCKS5 127.0.0.1:${port}`);
  const socket = await tunnel(local, "npm.example:443");
  const reply = new Promise<string>((resolve) =>
    socket.once("data", (chunk: Buffer) => resolve(chunk.toString())),
  );
  socket.write("socks upstream");
  expect(await reply).toBe("socks upstream");
  expect(destinations).toEqual(["npm.example"]);
  socket.destroy();
});
