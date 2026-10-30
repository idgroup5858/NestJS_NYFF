/**
 * Model ba'zan ko'rsatmaga qaramay Markdown yozadi (`**qalin**`, `# sarlavha`, `- ro'yxat`). Web chat ham, Telegram
 * ham javobni oddiy matn sifatida ko'rsatadi — belgilar olib tashlanadi, ro'yxat «•» bilan.
 */
export function plainText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^(\s*)[*-]\s+/gm, '$1• ')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim();
}
