// 普通 JSON 接口只需要小请求体；multipart 上传单独限制为 128 MiB。
export const MAX_JSON_BODY_SIZE = 64 * 1024;
export const MAX_STANDARD_UPLOAD_SIZE = 128 * 1024 * 1024;

/** 带 HTTP 状态码的请求体解析错误。 */
export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/**
 * 在读取流时按实际字节数限流，不能只信任客户端声明的 Content-Length。
 */
export async function readRequestBody(
  req: Request,
  maxBytes: number
): Promise<Buffer> {
  // Content-Length 可用于提前拒绝，但缺失或伪造时仍由下方流式计数兜底。
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyError("Request body is too large", 413);
  }

  if (!req.body) {
    return Buffer.alloc(0);
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      // 超限后立即停止继续接收请求体。
      await reader.cancel();
      throw new RequestBodyError("Request body is too large", 413);
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks, size);
}

/** 读取受限 JSON 请求体，并统一转换为可返回的 400 错误。 */
export async function readJsonBody<T>(req: Request): Promise<T> {
  const body = await readRequestBody(req, MAX_JSON_BODY_SIZE);
  try {
    return JSON.parse(body.toString("utf-8")) as T;
  } catch {
    throw new RequestBodyError("Invalid JSON request body", 400);
  }
}
