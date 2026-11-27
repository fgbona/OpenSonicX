'use client';

import { ROLES, presetRole, withRole } from '@/lib/workstation/banks';
import { useI18n } from '../I18n';

interface Props {
  name: string;
  /** The pedal's name length limit. */
  max: number;
  disabled?: boolean;
  onName: (name: string) => void;
}

/** CLEAN / RHY / LEAD: renames the preset to that role of its bank, keeping the prefix ("MTL-RHY" → "MTL-LEAD"). */
export function RoleButtons({ name, max, disabled = false, onName }: Props) {
  const { t } = useI18n();
  const current = presetRole(name);
  return (
    <fieldset className="ws-roles">
      <legend>{t('ws.roles')}</legend>
      {ROLES.map((role) => (
        <button
          key={role}
          type="button"
          className={`ws-role ws-role-${role}`}
          aria-pressed={current === role}
          aria-label={t('ws.roleAria', { role: role.toUpperCase() })}
          disabled={disabled}
          onClick={() => onName(withRole(name, role, max))}
        >
          {role.toUpperCase()}
        </button>
      ))}
    </fieldset>
  );
}

/** The role chip a preset list shows beside a name ending in -CLEAN, -RHY or -LEAD. */
export function RoleChip({ name }: { name: string }) {
  const role = presetRole(name);
  return role ? (
    <span className={`ws-role-chip ws-role-${role}`} aria-hidden="true">
      {role.toUpperCase()}
    </span>
  ) : null;
}
