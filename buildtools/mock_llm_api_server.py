"""模拟 LLM API Server（OpenAI Chat Completions 兼容）。

用途
- 用于本项目的本地/离线压测、联调、并发与流式行为验证。
- 仅使用标准库：不依赖 FastAPI/uvicorn/aiohttp 等第三方框架。

支持的端点
- POST /v1/chat/completions（也兼容 POST /chat/completions）
- GET /v1/models（也兼容 GET /models）
- GET /health

请求行为（与 LinguaGacha 的提示词结构匹配）
- 从请求 JSON 的 messages 中取“最后一个 role=user”的 content 文本。
- 在该文本中提取“最后一个” ```jsonline 代码块（避免命中提示词里“输出格式示例”的代码块）。
- 按输入 JSONLINE 的行数/序号，返回同等行数的随机文本 JSONLINE（放在 assistant.content 内）。

网络抖动
- 每个请求模拟抖动（默认 2~20 秒，可通过 --min-jitter/--max-jitter 调整）；
  流式场景会把总抖动拆分到多段 SSE 消息上。

一键启动示例（推荐用 uv）
1) 启动（本机回环，端口 8000）
   uv run python buildtools/mock_llm_api_server.py --host 127.0.0.1 --port 8000

2) 让 LinguaGacha 指向该服务
   API Base URL: http://127.0.0.1:8000/v1
   （或 http://127.0.0.1:8000 也可，本脚本同时兼容 /chat/completions）

3) curl 验证（非流式）
   curl -s http://127.0.0.1:8000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"mock-llm","messages":[{"role":"user","content":"Input:\n```jsonline\n{\"0\":\"a\"}\n{\"1\":\"b\"}\n```\n"}]}'

4) curl 验证（流式）
   curl -N http://127.0.0.1:8000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"mock-llm","stream":true,"messages":[{"role":"user","content":"Input:\n```jsonline\n{\"0\":\"a\"}\n{\"1\":\"b\"}\n```\n"}]}'

并发提示
- 需要更高并发（比如 2000+）时：优先调大 --backlog。
- 流式场景可调大 --stream-chunk-lines（每个 SSE chunk 携带更多 JSONLINE 行），降低消息数量与开销。

可选参数示例（压测/联调常用）
- 更高并发 + 降低流式开销
   uv run python buildtools/mock_llm_api_server.py --backlog 16384 --stream-chunk-lines 50
- 缩短抖动（更快回归）
   uv run python buildtools/mock_llm_api_server.py --min-jitter 0.2 --max-jitter 1.0
- 固定随机种子（输出可复现）
   uv run python buildtools/mock_llm_api_server.py --seed 12345
- 调整日志级别（排查协议/边界问题）
   uv run python buildtools/mock_llm_api_server.py --log-level DEBUG

参数示意（节选）
- --backlog: asyncio.start_server(..., backlog=...) 的 backlog；高并发下过小会更容易出现连接排队/拒绝。
- --stream-chunk-lines: 流式模式每个 SSE chunk 携带的 JSONLINE 行数；越大消息越少但首块可能更“粗”。
- --read-timeout: 单连接读取超时（秒），用于兜底卡死连接/模拟慢客户端。
- --max-header-bytes/--max-body-bytes: 请求头/体的上限，避免压测时异常请求撑爆内存。
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import random
import time
import uuid
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class HttpRequest:
    method: str
    target: str
    version: str
    headers: dict[str, str]
    body: bytes


class HttpError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class ClientDisconnected(Exception):
    """客户端中途断开连接（常见于流式请求被取消/页面关闭/压测中断）。"""


def is_client_disconnect_error(exc: BaseException) -> bool:
    if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
        return True

    if isinstance(exc, OSError):
        # Windows 常见：10053(连接被本机软件中止), 10054(连接被远端重置)
        winerr = getattr(exc, "winerror", None)
        return winerr in (10053, 10054)

    return False


STATUS_REASON: dict[int, str] = {
    200: "OK",
    204: "No Content",
    400: "Bad Request",
    404: "Not Found",
    405: "Method Not Allowed",
    411: "Length Required",
    413: "Payload Too Large",
    431: "Request Header Fields Too Large",
    500: "Internal Server Error",
}


def build_openai_error(
    message: str, *, error_type: str = "invalid_request_error"
) -> dict[str, Any]:
    return {
        "error": {
            "message": message,
            "type": error_type,
            "param": None,
            "code": None,
        }
    }


def normalize_header_name(name: str) -> str:
    return name.strip().lower()


def pick_user_prompt_text(messages: Any) -> str:
    if not isinstance(messages, list):
        return ""

    for msg in reversed(messages):
        if not isinstance(msg, dict):
            continue
        if msg.get("role") != "user":
            continue
        return coerce_message_text(msg.get("content"))

    if messages and isinstance(messages[-1], dict):
        return coerce_message_text(messages[-1].get("content"))
    return ""


def coerce_message_text(content: Any) -> str:
    if isinstance(content, str):
        return content

    # 兼容 OpenAI 的多段 content（如 [{"type":"text","text":"..."}]）
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") != "text":
                continue
            text = part.get("text")
            if isinstance(text, str) and text:
                parts.append(text)
        return "".join(parts)

    return str(content) if content is not None else ""


def extract_jsonline_block(text: str) -> str:
    """提取最后一个 ```jsonline 代码块的内容。

    为什么取最后一个：提示词里通常包含“输出格式示例”的 jsonline 代码块，
    真正的输入 JSONLINE 一般附在最后。
    """

    lines = text.splitlines()
    blocks: list[tuple[str, list[str]]] = []

    in_block = False
    current_lang = ""
    current_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            if not in_block:
                current_lang = stripped[3:].strip().lower()
                current_lines = []
                in_block = True
                continue

            blocks.append((current_lang, current_lines))
            in_block = False
            current_lang = ""
            current_lines = []
            continue

        if in_block:
            current_lines.append(line)

    for lang, payload_lines in reversed(blocks):
        if lang.startswith("jsonline") or lang.startswith("jsonl"):
            return "\n".join(payload_lines)

    return ""


def parse_jsonline_keys(jsonline_payload: str) -> list[str]:
    keys: list[str] = []
    for raw_line in jsonline_payload.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if isinstance(obj, dict) and len(obj) == 1:
            key = next(iter(obj.keys()))
            keys.append(str(key))
    return keys


def generate_random_text(
    rng: random.Random, *, min_words: int = 4, max_words: int = 10
) -> str:
    vocabulary = [
        "amber",
        "atlas",
        "breeze",
        "cascade",
        "cipher",
        "crystal",
        "dawn",
        "ember",
        "fable",
        "frost",
        "harbor",
        "hollow",
        "horizon",
        "ivy",
        "jolt",
        "kernel",
        "lantern",
        "lattice",
        "lumen",
        "marble",
        "meadow",
        "mosaic",
        "nebula",
        "needle",
        "octave",
        "oracle",
        "pebble",
        "prairie",
        "quartz",
        "ripple",
        "saffron",
        "sail",
        "silk",
        "sketch",
        "solace",
        "spark",
        "tide",
        "timber",
        "velvet",
        "whisper",
        "witness",
        "zenith",
    ]

    word_count = rng.randint(min_words, max_words)
    return " ".join(rng.choice(vocabulary) for _ in range(word_count))


def build_jsonline_response(keys: list[str], rng: random.Random) -> str:
    lines: list[str] = ["```jsonline"]
    for key in keys:
        text = generate_random_text(rng)
        lines.append(json.dumps({key: text}, ensure_ascii=False, separators=(",", ":")))
    lines.append("```")
    return "\n".join(lines) + "\n"


def estimate_tokens(text: str) -> int:
    # 近似估算：对压测/统计够用；避免引入第三方 tokenizer。
    stripped = text.strip()
    if not stripped:
        return 0
    return max(1, len(stripped) // 4)


def build_chat_completion_response(
    *,
    model: str,
    content: str,
    request_text: str,
) -> dict[str, Any]:
    created = int(time.time())
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"

    prompt_tokens = estimate_tokens(request_text)
    completion_tokens = estimate_tokens(content)
    usage = {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    }

    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": usage,
    }


def build_chat_completion_chunk(
    *,
    completion_id: str,
    created: int,
    model: str,
    delta: dict[str, Any],
    finish_reason: str | None,
    usage: dict[str, int] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason,
            }
        ],
    }
    if usage is not None:
        payload["usage"] = usage
    return payload


def build_final_usage(*, request_text: str, response_text: str) -> dict[str, int]:
    prompt_tokens = estimate_tokens(request_text)
    completion_tokens = estimate_tokens(response_text)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    }


def build_cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
    }


def build_response_headers(
    *,
    content_type: str,
    content_length: int | None,
    connection_close: bool,
) -> dict[str, str]:
    headers: dict[str, str] = {
        "Content-Type": content_type,
        **build_cors_headers(),
    }

    if content_length is not None:
        headers["Content-Length"] = str(content_length)

    headers["Connection"] = "close" if connection_close else "keep-alive"
    return headers


async def write_http_response(
    writer: asyncio.StreamWriter,
    *,
    status: int,
    headers: dict[str, str],
    body: bytes,
) -> None:
    reason = STATUS_REASON.get(status, "")
    header_lines = [f"HTTP/1.1 {status} {reason}\r\n"]
    for k, v in headers.items():
        header_lines.append(f"{k}: {v}\r\n")
    header_lines.append("\r\n")
    try:
        writer.write("".join(header_lines).encode("latin-1"))
        if body:
            writer.write(body)
        await writer.drain()
    except Exception as e:
        if is_client_disconnect_error(e):
            raise ClientDisconnected() from e
        raise


async def write_chunk(writer: asyncio.StreamWriter, data: bytes) -> None:
    size_line = f"{len(data):X}\r\n".encode("ascii")
    try:
        writer.write(size_line)
        writer.write(data)
        writer.write(b"\r\n")
        await writer.drain()
    except Exception as e:
        if is_client_disconnect_error(e):
            raise ClientDisconnected() from e
        raise


async def write_chunked_sse(
    writer: asyncio.StreamWriter,
    *,
    sse_messages: list[str],
    delays_s: list[float],
    headers: dict[str, str],
) -> None:
    reason = STATUS_REASON.get(200, "")
    header_lines = [f"HTTP/1.1 200 {reason}\r\n"]
    for k, v in headers.items():
        header_lines.append(f"{k}: {v}\r\n")
    header_lines.append("\r\n")
    try:
        writer.write("".join(header_lines).encode("latin-1"))
        await writer.drain()
    except Exception as e:
        if is_client_disconnect_error(e):
            raise ClientDisconnected() from e
        raise

    for msg, delay_s in zip(sse_messages, delays_s, strict=True):
        if delay_s > 0:
            await asyncio.sleep(delay_s)
        await write_chunk(writer, msg.encode("utf-8"))

    try:
        writer.write(b"0\r\n\r\n")
        await writer.drain()
    except Exception as e:
        if is_client_disconnect_error(e):
            raise ClientDisconnected() from e
        raise


def split_total_delay(
    total_delay_s: float, parts: int, rng: random.Random
) -> list[float]:
    if parts <= 0:
        return []
    if total_delay_s <= 0:
        return [0.0] * parts

    # 采用简单的 Dirichlet-like 方案，把总延迟拆成若干段。
    weights = [rng.random() for _ in range(parts)]
    denom = sum(weights) or 1.0
    return [total_delay_s * (w / denom) for w in weights]


def group_lines_for_streaming(lines: list[str], chunk_lines: int) -> list[str]:
    if chunk_lines <= 0:
        chunk_lines = 1

    chunks: list[str] = []
    i = 0
    while i < len(lines):
        group = lines[i : i + chunk_lines]
        chunks.append("\n".join(group) + "\n")
        i += chunk_lines
    return chunks


def build_stream_content_chunks(
    keys: list[str], rng: random.Random, chunk_lines: int
) -> list[str]:
    json_lines = [
        json.dumps(
            {key: generate_random_text(rng)}, ensure_ascii=False, separators=(",", ":")
        )
        for key in keys
    ]

    chunks = ["```jsonline\n"]
    chunks.extend(group_lines_for_streaming(json_lines, chunk_lines))
    chunks.append("```\n")
    return chunks


async def handle_chat_completions(
    request: HttpRequest,
    writer: asyncio.StreamWriter,
    *,
    min_jitter_s: float,
    max_jitter_s: float,
    stream_chunk_lines: int,
    seed: int | None,
) -> None:
    if request.method != "POST":
        raise HttpError(405, "Only POST is supported")

    try:
        data = json.loads(request.body.decode("utf-8"))
    except Exception as e:
        raise HttpError(400, f"Invalid JSON body: {e}") from e

    if seed is None:
        rng = random.Random()
    else:
        digest = hashlib.blake2b(request.body, digest_size=8).digest()
        derived = seed ^ int.from_bytes(digest, byteorder="big", signed=False)
        rng = random.Random(derived)

    model = str(data.get("model") or "mock-llm")
    messages = data.get("messages")
    request_text = pick_user_prompt_text(messages)

    jsonline_payload = extract_jsonline_block(request_text)
    keys = parse_jsonline_keys(jsonline_payload)
    if not keys:
        non_empty_lines = [v for v in jsonline_payload.splitlines() if v.strip()]
        if non_empty_lines:
            keys = [str(i) for i in range(len(non_empty_lines))]
        else:
            # 兜底：没有解析到输入 JSONLINE 时，仍然返回 1 行，避免调用方卡死。
            keys = ["0"]

    stream = bool(data.get("stream", False))
    stream_options = data.get("stream_options")
    include_usage = False
    if isinstance(stream_options, dict):
        include_usage = bool(stream_options.get("include_usage", False))

    total_delay_s = rng.uniform(min_jitter_s, max_jitter_s)

    if not stream:
        response_content = build_jsonline_response(keys, rng)
        payload = build_chat_completion_response(
            model=model,
            content=response_content,
            request_text=request_text,
        )
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        await asyncio.sleep(total_delay_s)
        headers = build_response_headers(
            content_type="application/json; charset=utf-8",
            content_length=len(body),
            connection_close=True,
        )
        await write_http_response(writer, status=200, headers=headers, body=body)
        return

    completion_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
    created = int(time.time())

    content_chunks = build_stream_content_chunks(keys, rng, stream_chunk_lines)

    sse_messages: list[str] = []

    # role
    sse_messages.append(
        "data: "
        + json.dumps(
            build_chat_completion_chunk(
                completion_id=completion_id,
                created=created,
                model=model,
                delta={"role": "assistant"},
                finish_reason=None,
            ),
            ensure_ascii=False,
        )
        + "\n\n"
    )

    # content
    for chunk in content_chunks:
        sse_messages.append(
            "data: "
            + json.dumps(
                build_chat_completion_chunk(
                    completion_id=completion_id,
                    created=created,
                    model=model,
                    delta={"content": chunk},
                    finish_reason=None,
                ),
                ensure_ascii=False,
            )
            + "\n\n"
        )

    # stop
    sse_messages.append(
        "data: "
        + json.dumps(
            build_chat_completion_chunk(
                completion_id=completion_id,
                created=created,
                model=model,
                delta={},
                finish_reason="stop",
            ),
            ensure_ascii=False,
        )
        + "\n\n"
    )

    if include_usage:
        response_text = "".join(content_chunks)
        usage = build_final_usage(
            request_text=request_text, response_text=response_text
        )

        # OpenAI 约定：include_usage 会在 stream 中额外带一次 usage。
        payload = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [],
            "usage": usage,
        }
        sse_messages.append("data: " + json.dumps(payload, ensure_ascii=False) + "\n\n")

    sse_messages.append("data: [DONE]\n\n")

    delays = split_total_delay(total_delay_s, len(sse_messages), rng)

    headers = {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Transfer-Encoding": "chunked",
        **build_cors_headers(),
        "Connection": "close",
    }
    await write_chunked_sse(
        writer,
        sse_messages=sse_messages,
        delays_s=delays,
        headers=headers,
    )


async def handle_models(request: HttpRequest, writer: asyncio.StreamWriter) -> None:
    if request.method != "GET":
        raise HttpError(405, "Only GET is supported")

    body_obj = {
        "object": "list",
        "data": [
            {
                "id": "mock-llm",
                "object": "model",
                "created": int(time.time()),
                "owned_by": "mock",
            }
        ],
    }
    body = json.dumps(body_obj, ensure_ascii=False).encode("utf-8")
    headers = build_response_headers(
        content_type="application/json; charset=utf-8",
        content_length=len(body),
        connection_close=True,
    )
    await write_http_response(writer, status=200, headers=headers, body=body)


async def handle_health(request: HttpRequest, writer: asyncio.StreamWriter) -> None:
    if request.method != "GET":
        raise HttpError(405, "Only GET is supported")

    body = b"ok\n"
    headers = build_response_headers(
        content_type="text/plain; charset=utf-8",
        content_length=len(body),
        connection_close=True,
    )
    await write_http_response(writer, status=200, headers=headers, body=body)


async def handle_options(writer: asyncio.StreamWriter) -> None:
    headers = {
        **build_cors_headers(),
        "Content-Length": "0",
        "Connection": "close",
    }
    await write_http_response(writer, status=204, headers=headers, body=b"")


async def read_request_head(
    reader: asyncio.StreamReader,
    *,
    read_timeout_s: float,
    max_header_bytes: int,
) -> tuple[str, str, str, dict[str, str]] | None:
    try:
        request_line_bytes = await asyncio.wait_for(
            reader.readline(), timeout=read_timeout_s
        )
    except TimeoutError:
        return None

    if not request_line_bytes:
        return None

    if len(request_line_bytes) > max_header_bytes:
        raise HttpError(431, "Request line too large")

    request_line = request_line_bytes.decode("latin-1").rstrip("\r\n")
    parts = request_line.split()
    if len(parts) != 3:
        raise HttpError(400, "Malformed request line")

    method, target, version = parts
    headers: dict[str, str] = {}

    total = 0
    while True:
        line = await asyncio.wait_for(reader.readline(), timeout=read_timeout_s)
        if not line:
            break

        total += len(line)
        if total > max_header_bytes:
            raise HttpError(431, "Headers too large")

        if line in (b"\r\n", b"\n"):
            break

        text = line.decode("latin-1").rstrip("\r\n")
        if ":" not in text:
            continue
        name, value = text.split(":", 1)
        headers[normalize_header_name(name)] = value.strip()

    return method, target, version, headers


async def read_http_request(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    *,
    read_timeout_s: float,
    max_header_bytes: int,
    max_body_bytes: int,
) -> HttpRequest | None:
    head = await read_request_head(
        reader,
        read_timeout_s=read_timeout_s,
        max_header_bytes=max_header_bytes,
    )
    if head is None:
        return None

    method, target, version, headers = head

    if headers.get("expect", "").lower() == "100-continue":
        writer.write(b"HTTP/1.1 100 Continue\r\n\r\n")
        await writer.drain()

    if (
        "transfer-encoding" in headers
        and "chunked" in headers["transfer-encoding"].lower()
    ):
        raise HttpError(411, "Chunked request bodies are not supported")

    content_length_text = headers.get("content-length", "")
    if content_length_text == "":
        content_length = 0
    else:
        try:
            content_length = int(content_length_text)
        except Exception as e:
            raise HttpError(400, f"Invalid Content-Length: {e}") from e

    if content_length > max_body_bytes:
        raise HttpError(413, f"Body too large (>{max_body_bytes} bytes)")

    body = b""
    if content_length > 0:
        try:
            body = await asyncio.wait_for(
                reader.readexactly(content_length), timeout=read_timeout_s
            )
        except asyncio.IncompleteReadError as e:
            raise HttpError(400, "Incomplete request body") from e
        except TimeoutError as e:
            raise HttpError(400, "Request body read timeout") from e

    return HttpRequest(
        method=method, target=target, version=version, headers=headers, body=body
    )


def get_path_only(target: str) -> str:
    if "?" in target:
        return target.split("?", 1)[0]
    return target


async def handle_connection(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    *,
    read_timeout_s: float,
    max_header_bytes: int,
    max_body_bytes: int,
    min_jitter_s: float,
    max_jitter_s: float,
    stream_chunk_lines: int,
    seed: int | None,
) -> None:
    peer = writer.get_extra_info("peername")

    try:
        request = await read_http_request(
            reader,
            writer,
            read_timeout_s=read_timeout_s,
            max_header_bytes=max_header_bytes,
            max_body_bytes=max_body_bytes,
        )
        if request is None:
            return

        path = get_path_only(request.target)

        if request.method == "OPTIONS":
            await handle_options(writer)
            return

        if path == "/health":
            await handle_health(request, writer)
            return

        if path in ("/v1/models", "/models"):
            await handle_models(request, writer)
            return

        if path in ("/v1/chat/completions", "/chat/completions"):
            await handle_chat_completions(
                request,
                writer,
                min_jitter_s=min_jitter_s,
                max_jitter_s=max_jitter_s,
                stream_chunk_lines=stream_chunk_lines,
                seed=seed,
            )
            return

        raise HttpError(404, f"Not found: {path}")

    except ClientDisconnected:
        # 客户端在服务端写回数据时断开；这在流式/压测/取消请求时非常常见。
        return

    except HttpError as e:
        logging.getLogger(__name__).warning(
            "%s %s -> %s (%s)", peer, "error", e.status, e.message
        )
        body_obj = build_openai_error(e.message)
        body = json.dumps(body_obj, ensure_ascii=False).encode("utf-8")
        headers = build_response_headers(
            content_type="application/json; charset=utf-8",
            content_length=len(body),
            connection_close=True,
        )
        try:
            await write_http_response(
                writer, status=e.status, headers=headers, body=body
            )
        except Exception:
            pass
        return
    except Exception as e:
        logging.getLogger(__name__).exception("Unhandled error: %s", e)
        body_obj = build_openai_error(
            "Internal server error", error_type="server_error"
        )
        body = json.dumps(body_obj, ensure_ascii=False).encode("utf-8")
        headers = build_response_headers(
            content_type="application/json; charset=utf-8",
            content_length=len(body),
            connection_close=True,
        )
        try:
            await write_http_response(writer, status=500, headers=headers, body=body)
        except Exception:
            pass
        return
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Mock OpenAI Chat Completions LLM API server (streaming + non-streaming)"
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--backlog", type=int, default=4096)
    parser.add_argument("--read-timeout", type=float, default=30.0)
    parser.add_argument("--max-header-bytes", type=int, default=64 * 1024)
    parser.add_argument("--max-body-bytes", type=int, default=16 * 1024 * 1024)
    parser.add_argument("--min-jitter", type=float, default=2.0)
    parser.add_argument("--max-jitter", type=float, default=20.0)
    parser.add_argument(
        "--stream-chunk-lines",
        type=int,
        default=10,
        help="JSONLINE lines per SSE chunk in streaming mode (larger = less overhead)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Fix RNG seed for reproducible output",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    return parser.parse_args()


async def run_server(args: argparse.Namespace) -> None:
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="[%(asctime)s] %(levelname)s %(message)s",
    )

    if args.min_jitter < 0 or args.max_jitter < 0 or args.max_jitter < args.min_jitter:
        raise SystemExit("Invalid jitter range")

    server = await asyncio.start_server(
        lambda r, w: handle_connection(
            r,
            w,
            read_timeout_s=float(args.read_timeout),
            max_header_bytes=int(args.max_header_bytes),
            max_body_bytes=int(args.max_body_bytes),
            min_jitter_s=float(args.min_jitter),
            max_jitter_s=float(args.max_jitter),
            stream_chunk_lines=int(args.stream_chunk_lines),
            seed=args.seed,
        ),
        host=args.host,
        port=args.port,
        backlog=int(args.backlog),
    )

    addrs = ", ".join(str(sock.getsockname()) for sock in (server.sockets or []))
    logging.getLogger(__name__).info("Mock LLM API server listening on %s", addrs)
    logging.getLogger(__name__).info(
        "Endpoints: POST /v1/chat/completions, GET /v1/models, GET /health"
    )

    async with server:
        await server.serve_forever()


def main() -> None:
    args = parse_args()
    asyncio.run(run_server(args))


if __name__ == "__main__":
    main()
