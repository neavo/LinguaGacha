import http from "node:http";
import net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  close_api_gateway_with_connections,
  track_api_gateway_connections,
} from "./api-gateway-connections";

describe("api-gateway-connections", () => {
  const cleanup_callbacks: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanup_callbacks.length > 0) {
      const cleanup = cleanup_callbacks.pop();
      await cleanup?.();
    }
  });

  it("连接自然关闭后会从 Gateway 连接集合移除", async () => {
    const server = http.createServer();
    const sockets = new Set<net.Socket>();
    track_api_gateway_connections(server, sockets);
    cleanup_callbacks.push(() => close_node_server(server));

    const port = await listen_on_loopback(server);
    const socket = await connect_to_loopback(port);

    expect(sockets.size).toBe(1);

    const closed = wait_for_socket_close(socket);
    socket.destroy();
    await closed;

    expect(sockets.size).toBe(0);
  });

  it("关闭 Gateway 时会销毁仍保持的连接并清空集合", async () => {
    const server = http.createServer();
    const sockets = new Set<net.Socket>();
    track_api_gateway_connections(server, sockets);
    cleanup_callbacks.push(() => close_node_server(server));

    const port = await listen_on_loopback(server);
    const socket = await connect_to_loopback(port);
    const closed = wait_for_socket_close(socket);

    expect(sockets.size).toBe(1);

    await close_api_gateway_with_connections(server, sockets);
    await closed;

    expect(socket.destroyed).toBe(true);
    expect(sockets.size).toBe(0);
  });

  async function listen_on_loopback(server: http.Server): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("测试端口未取得地址。");
    }
    return address.port;
  }

  async function connect_to_loopback(port: number): Promise<net.Socket> {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    return socket;
  }

  async function wait_for_socket_close(socket: net.Socket): Promise<void> {
    await new Promise<void>((resolve) => {
      socket.once("close", () => {
        resolve();
      });
    });
  }

  async function close_node_server(server: http.Server): Promise<void> {
    if (!server.listening) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});
