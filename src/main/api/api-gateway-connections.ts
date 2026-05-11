import type { Server } from "node:http";
import type { Socket } from "node:net";

/**
 * 记录 HTTP server 的活动连接，让退出流程能主动切断 SSE / keep-alive 长连接。
 */
export function track_api_gateway_connections(server: Server, sockets: Set<Socket>): void {
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
  });
}

/**
 * 关闭监听器并销毁仍未自然结束的连接，避免 server.close() 被长连接永久挂住。
 */
export async function close_api_gateway_with_connections(
  server: Server,
  sockets: Set<Socket>,
): Promise<void> {
  const close_promise = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  for (const socket of Array.from(sockets)) {
    socket.destroy();
  }

  await close_promise;
  sockets.clear();
}
