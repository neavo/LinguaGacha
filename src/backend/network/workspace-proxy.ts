import http, { type ClientRequest, type IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import type { Duplex } from "node:stream";
import { randomBytes } from "node:crypto";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { SocksClient } from "socks";
import { resolve_proxy_route, type ProxyResolver } from "./proxy-route";

/** 工作区进程的默认代理桥接应用路由，连接与共享执行一起收尾。 */
export class WorkspaceProxy {
  private readonly token = randomBytes(24).toString("hex");
  private readonly server = http.createServer();
  private readonly sockets = new Set<Duplex>(); // CONNECT 建立后，隧道独立于 HTTP 请求存活。
  private readonly requests = new Set<ClientRequest>(); // 关闭时也要中断尚未完成的上游握手。
  private readonly agents = new Set<http.Agent>();
  private readonly operations = new Set<Promise<void>>(); // 路由解析可能还没有创建连接，也必须排空。
  private readonly controller = new AbortController();
  private endpoint = "";

  /** 认证通过后才启动转发，失败响应归各协议入口处理。 */
  private constructor(private readonly resolver: ProxyResolver) {
    this.server.on("connection", (socket) => this.track(socket));
    this.server.on("request", (request, response) => {
      if (!this.authenticate(request)) {
        response.writeHead(407);
        response.end();
        return;
      }
      this.execute(
        () => this.forward(request, response),
        () => {
          if (!response.headersSent) response.writeHead(502);
          response.end();
        },
      );
    });
    this.server.on("connect", (request, socket, head) => {
      if (!this.authenticate(request)) {
        socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
        return;
      }
      this.execute(
        () => this.tunnel(request, socket, head),
        () => socket.destroy(),
      );
    });
  }

  /** HTTP 转发保留原始载荷，避免自动解压改变响应头与内容的对应关系。 */
  private async forward(request: IncomingMessage, response: http.ServerResponse): Promise<void> {
    const target = new URL(request.url ?? "");
    const route = await resolve_proxy_route(this.resolver, target.href, this.controller.signal);
    this.controller.signal.throwIfAborted();
    const secure = target.protocol === "https:";
    if (!secure && target.protocol !== "http:")
      throw new Error("Unsupported proxy target protocol.");
    const agent =
      route.kind === "direct"
        ? undefined
        : route.kind === "socks5"
          ? new SocksProxyAgent(route.uri)
          : secure
            ? new HttpsProxyAgent(route.uri)
            : new HttpProxyAgent(route.uri);
    if (agent) this.agents.add(agent);
    const headers: http.OutgoingHttpHeaders = { ...request.headers, host: target.host };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    await new Promise<void>((resolve, reject) => {
      const outgoing = (secure ? https : http).request(
        target,
        { method: request.method, headers, agent, signal: this.controller.signal },
        (incoming) => {
          response.writeHead(incoming.statusCode ?? 502, incoming.headers);
          incoming.on("error", reject);
          incoming.pipe(response);
          incoming.on("end", resolve);
        },
      );
      this.requests.add(outgoing);
      outgoing.once("close", () => {
        this.requests.delete(outgoing);
        if (agent) {
          agent.destroy();
          this.agents.delete(agent);
        }
      });
      outgoing.on("error", reject);
      response.once("close", () => outgoing.destroy());
      request.pipe(outgoing);
    });
  }

  /** CONNECT 转发原始字节，目标 TLS 仍由调用方与目标端完成。 */
  private async tunnel(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const target = new URL(`https://${request.url}`);
    const route = await resolve_proxy_route(this.resolver, target.href, this.controller.signal);
    this.controller.signal.throwIfAborted();
    const hostname = target.hostname.replace(/^\[|\]$/gu, "");
    const port = Number(target.port || 443);
    let upstream: Duplex;
    let initial: Buffer = Buffer.alloc(0);
    if (route.kind === "direct") {
      upstream = await this.connect(hostname, port);
    } else if (route.kind === "socks5") {
      const proxy = new URL(route.uri);
      const transport = await this.connect(proxy.hostname, Number(proxy.port || 1080));
      upstream = (
        await SocksClient.createConnection({
          command: "connect",
          destination: { host: hostname, port },
          existing_socket: transport,
          proxy: {
            host: proxy.hostname,
            port: Number(proxy.port || 1080),
            type: 5,
            userId: decodeURIComponent(proxy.username),
            password: decodeURIComponent(proxy.password),
          },
        })
      ).socket;
    } else {
      const proxy = new URL(route.uri);
      const authority = `${target.hostname}:${port}`;
      const headers: http.OutgoingHttpHeaders = { host: authority };
      if (proxy.username || proxy.password)
        headers["proxy-authorization"] =
          `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
      proxy.username = "";
      proxy.password = "";
      const tunnel = await new Promise<{ socket: Duplex; head: Buffer }>((resolve, reject) => {
        const outgoing = (proxy.protocol === "https:" ? https : http).request(proxy, {
          method: "CONNECT",
          path: authority,
          headers,
          // CONNECT 的 Host 是目标，TLS 证书仍须核对上游代理身份。
          servername: net.isIP(proxy.hostname.replace(/^\[|\]$/gu, "")) ? "" : proxy.hostname,
          signal: this.controller.signal,
        });
        this.requests.add(outgoing);
        outgoing.once("close", () => this.requests.delete(outgoing));
        outgoing.once("error", reject);
        outgoing.once("connect", (response, connected, head) => {
          this.track(connected);
          if (response.statusCode !== 200) {
            connected.destroy();
            reject(new Error(`Upstream CONNECT failed: ${response.statusCode}`));
          } else resolve({ socket: connected, head });
        });
        outgoing.end();
      });
      upstream = tunnel.socket;
      initial = tunnel.head;
    }
    this.track(upstream);
    this.controller.signal.throwIfAborted();
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    if (initial.length) socket.write(initial);
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.once("close", () => upstream.destroy());
    upstream.once("close", () => socket.destroy());
    upstream.pipe(socket).pipe(upstream);
  }

  /** 监听成功后才向子进程提供本次独占的回环端点。 */
  public static async start(resolver: ProxyResolver): Promise<WorkspaceProxy> {
    const proxy = new WorkspaceProxy(resolver);
    await new Promise<void>((resolve, reject) => {
      proxy.server.once("error", reject);
      proxy.server.listen(0, "127.0.0.1", () => {
        proxy.server.removeListener("error", reject);
        resolve();
      });
    });
    const address = proxy.server.address();
    if (address === null || typeof address === "string")
      throw new Error("Invalid workspace proxy address.");
    proxy.endpoint = `http://lg:${proxy.token}@127.0.0.1:${address.port}`;
    return proxy;
  }

  /** 地址携带本次凭证，只用于子进程环境。 */
  public get url(): string {
    return this.endpoint;
  }

  /** 本机凭证仅在当前执行有效，不复用应用或目标站点的认证。 */
  private authenticate(request: IncomingMessage): boolean {
    return (
      request.headers["proxy-authorization"] ===
      `Basic ${Buffer.from(`lg:${this.token}`).toString("base64")}`
    );
  }

  /** 收尾期间才建立的连接也必须纳入当前执行并立即关闭。 */
  private track(socket: Duplex): void {
    this.sockets.add(socket);
    // 对端断开和取消都会重置连接，失败回执由所属请求负责，连接本身仍须收尾。
    socket.on("error", () => socket.destroy());
    socket.once("close", () => this.sockets.delete(socket));
    if (this.controller.signal.aborted) socket.destroy();
  }

  /** 建连期间也接受统一取消，避免握手失败留下未登记的套接字。 */
  private async connect(host: string, port: number): Promise<net.Socket> {
    const socket = net.createConnection({ host, port, signal: this.controller.signal });
    this.track(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    return socket;
  }

  /** 收尾等待所有路由和握手完成，迟到连接仍归当前操作。 */
  private execute(operation: () => Promise<void>, failed: () => void): void {
    const pending = operation()
      .catch(failed)
      .finally(() => this.operations.delete(pending));
    this.operations.add(pending);
  }

  /** 先中断再排空，防止监听器关闭后仍有异步转发创建连接。 */
  public async close(): Promise<void> {
    this.controller.abort(new Error("Workspace proxy closed."));
    const closed = new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
    for (const request of this.requests) request.destroy();
    for (const agent of this.agents) agent.destroy();
    const sockets_closed = [...this.sockets].map(
      (socket) =>
        new Promise<void>((resolve) => {
          socket.once("close", resolve);
          socket.destroy();
        }),
    );
    await Promise.all([closed, ...sockets_closed, ...this.operations]);
  }
}
