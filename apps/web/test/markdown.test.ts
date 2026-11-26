import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../lib/markdown.ts';

test('bold, italic, code and lists become structure, not asterisks', () => {
  const b = parseMarkdown('**Amp:** Calif `DualM`, *tight*\n- Gain 70\n- Bass 40\n\n1. one\n2. two');
  assert.deepEqual(b[0], {
    kind: 'p',
    children: [
      { kind: 'bold', children: [{ kind: 'text', text: 'Amp:' }] },
      { kind: 'text', text: ' Calif ' },
      { kind: 'code', text: 'DualM' },
      { kind: 'text', text: ', ' },
      { kind: 'italic', children: [{ kind: 'text', text: 'tight' }] },
    ],
  });
  assert.equal(b[1]?.kind, 'ul');
  assert.equal(b[1]?.kind === 'ul' && b[1].items.length, 2);
  assert.equal(b[2]?.kind, 'ol');
});

test('single newlines are line breaks and blank lines split paragraphs', () => {
  const b = parseMarkdown('a\nb\n\nc');
  assert.equal(b.length, 2);
  assert.deepEqual(b[0], { kind: 'p', children: [{ kind: 'text', text: 'a' }, { kind: 'br' }, { kind: 'text', text: 'b' }] });
});

test('HTML-looking input stays plain text', () => {
  const evil = '<img src=x onerror=alert(1)> <script>x</script>';
  assert.deepEqual(parseMarkdown(evil), [{ kind: 'p', children: [{ kind: 'text', text: evil }] }]);
});

test('unmatched markers and snake_case are left alone', () => {
  assert.deepEqual(parseMarkdown('a * b and my_var_name'), [{ kind: 'p', children: [{ kind: 'text', text: 'a * b and my_var_name' }] }]);
});
