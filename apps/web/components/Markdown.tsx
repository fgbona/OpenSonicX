import type { ReactNode } from 'react';
import { type Inline, parseMarkdown } from '@/lib/markdown';

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case 'text':
        return n.text;
      case 'br':
        return <br key={i} />;
      case 'code':
        return <code key={i}>{n.text}</code>;
      case 'bold':
        return <strong key={i}>{inline(n.children)}</strong>;
      case 'italic':
        return <em key={i}>{inline(n.children)}</em>;
    }
  });
}

/** Renders the safe Markdown subset as React elements: text is never interpreted as HTML. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {parseMarkdown(text).map((b, i) => {
        if (b.kind === 'p') return <p key={i}>{inline(b.children)}</p>;
        const List = b.kind;
        return (
          <List key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
