/**
 * The tools of the AI connection that store something on the unit. Each needs the typed confirm
 * the stdio server asks for (the slot label repeated) and then the person's Allow in the app's
 * approval dialog; live edits need neither (they show on screen and Undo takes them back).
 */
export interface AiTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: { readonly type: 'object'; readonly properties?: Record<string, object>; readonly required?: readonly string[] };
}

export interface Approval {
  readonly tool: string;
  /** What will be written, in the person's words. */
  readonly what: string;
  readonly slot: string;
}

const arg = (args: Record<string, unknown>, key: string) => (typeof args[key] === 'string' ? (args[key] as string).trim() : '');

/** The writes, by tool name, and the slot argument each one overwrites. */
const WRITES: Readonly<Record<string, { slotArg: string; what: (args: Record<string, unknown>, pt: boolean) => string }>> = {
  save_preset: { slotArg: 'slot', what: (a, pt) => (pt ? `salvar o som atual como "${arg(a, 'name')}"` : `save the current sound as "${arg(a, 'name')}"`) },
  matribox_save_preset: { slotArg: 'slot', what: (a, pt) => (pt ? `salvar o som atual como "${arg(a, 'name')}"` : `save the current sound as "${arg(a, 'name')}"`) },
};

export const needsApproval = (tool: string): boolean => Object.hasOwn(WRITES, tool);

const CONFIRM = { type: 'string', description: 'Must repeat the slot label (e.g. "P03" or "12A"), confirming the user asked to overwrite that slot' };

/** The tools as the AI client sees them: the writes get the required confirm argument. */
export function withConfirm(tools: readonly AiTool[]): AiTool[] {
  return tools.map((t) =>
    needsApproval(t.name)
      ? {
          ...t,
          description: `${t.description} Stores on the unit: the person must also allow it in OpenSonicX.`,
          inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties, confirm: CONFIRM }, required: [...(t.inputSchema.required ?? []), 'confirm'] },
        }
      : t,
  );
}

/** What the approval dialog asks about, or throws when the typed confirm does not repeat the slot. */
export function approvalFor(tool: string, args: Record<string, unknown>, pt = false): Approval {
  const write = WRITES[tool];
  if (!write) throw new Error(`${tool} does not store anything`);
  const slot = arg(args, write.slotArg).toUpperCase();
  if (slot === '' || arg(args, 'confirm').toUpperCase() !== slot) throw new Error(`confirm must repeat the slot label ("${slot || write.slotArg}"), confirming the user asked to overwrite it`);
  return { tool, what: write.what(args, pt), slot };
}

/** The approval dialog's text. */
export function approvalText({ what, slot }: Approval, pt = false): { message: string; detail: string; allow: string; deny: string } {
  return pt
    ? {
        message: `A IA conectada quer ${what} no slot ${slot}, sobrescrevendo-o.`,
        detail: 'O pedido veio pela Conexão da IA (um cliente MCP neste computador). Se você não pediu isso, negue.',
        allow: 'Permitir',
        deny: 'Negar',
      }
    : {
        message: `The connected AI wants to ${what} in slot ${slot}, overwriting it.`,
        detail: 'The request came through the AI connection (an MCP client on this computer). If you did not ask for this, deny it.',
        allow: 'Allow',
        deny: 'Deny',
      };
}
