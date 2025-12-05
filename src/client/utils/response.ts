/**
 * 安全解析 JSON 响应
 * 如果解析失败，返回包含原始文本的对象
 */
export function parseJsonResponse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
