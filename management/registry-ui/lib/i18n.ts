/**
 * 从 API 错误对象中提取错误消息。
 * sessionApi / portalSessionApi 抛出 { error: string, status: number }，
 * 此函数安全地提取 error 字段。
 */
export function getErrorMessage(e: unknown, fallback: string): string {
  if (
    typeof e === 'object' &&
    e !== null &&
    'error' in e &&
    typeof (e as { error: unknown }).error === 'string'
  ) {
    return (e as { error: string }).error || fallback;
  }
  return fallback;
}
