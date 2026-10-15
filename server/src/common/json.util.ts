/**
 * 大模型输出 JSON 的清洗与容错（见技术方案 6.1）：
 * 1. 剥离可能存在的 markdown 代码围栏（```json ... ```）
 * 2. 提取第一个 { 到最后一个 } 之间的内容
 * 3. JSON.parse 失败时抛出可读异常，由调用方决定重试
 */
export function extractJson<T = unknown>(raw: string): T {
  if (!raw || !raw.trim()) {
    throw new Error('模型返回为空');
  }
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('模型返回中未找到 JSON 结构');
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    throw new Error('JSON 解析失败');
  }
}
