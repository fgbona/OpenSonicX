/** A tiny, safe Markdown subset for assistant replies: bold, italic, inline code, bullet and numbered lists, line breaks. Anything else stays plain text. */
export type Inline = { kind: 'text'; text: string } | { kind: 'bold' | 'italic'; children: Inline[] } | { kind: 'code'; text: string } | { kind: 'br' };
export type Block = { kind: 'p'; children: Inline[] } | { kind: 'ul' | 'ol'; items: Inline[][] };

const TOKEN = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|(?<![*\w])\*([^*\s][^*\n]*?)\*(?![*\w])|(?<![\w])_([^_\s][^_\n]*?)_(?![\w])/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  for (let m = TOKEN.exec(rest); m; m = TOKEN.exec(rest)) {
    if (m.index > 0) out.push({ kind: 'text', text: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'code', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'bold', children: parseInline(m[2]) });
    else out.push({ kind: 'italic', children: parseInline(m[3] ?? m[4] ?? '') });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) out.push({ kind: 'text', text: rest });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length === 0) return;
    const children = para.flatMap((line, i): Inline[] => (i === 0 ? parseInline(line) : [{ kind: 'br' }, ...parseInline(line)]));
    blocks.push({ kind: 'p', children });
    para = [];
  };
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      flush();
      const kind = bullet ? 'ul' : 'ol';
      const last = blocks[blocks.length - 1];
      if (last?.kind === kind) last.items.push(parseInline(item[1] ?? ''));
      else blocks.push({ kind, items: [parseInline(item[1] ?? '')] });
    } else if (line.trim() === '') flush();
    else para.push(line.trim());
  }
  flush();
  return blocks;
}
