/** 从平台分享文案中提取首个链接，页面与 Agent 共用。 */
export function extractMediaLink(input: string): string {
  const text = input.trim();
  const match = /https?:\/\/[^\s<>"`\u3000-\u303f\u4e00-\u9fff]+/i.exec(text);
  return (match?.[0] ?? text).replace(/[),.;!，。；！）]+$/, '');
}
