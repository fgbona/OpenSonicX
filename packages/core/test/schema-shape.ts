/** Renders a JSON Schema as a short signature, for contract tests (MCP tools and chat tools). */
export type Schema = { type?: string | string[]; enum?: unknown[]; items?: Schema; properties?: Record<string, Schema>; required?: string[]; anyOf?: Schema[]; oneOf?: Schema[]; const?: unknown };

/** A parameter's shape without its description: what an assistant's call has to match. */
export function shape(s: Schema): string {
  const union = s.anyOf ?? s.oneOf;
  if (union) return `(${union.map(shape).join(' | ')})`;
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (s.type === 'array') return `${shape(s.items ?? {})}[]`;
  if (s.properties) {
    return `{ ${Object.entries(s.properties).map(([k, v]) => `${k}${s.required?.includes(k) ? '' : '?'}: ${shape(v)}`).join(', ')} }`;
  }
  return [s.type ?? 'any'].flat().join(' | ');
}
