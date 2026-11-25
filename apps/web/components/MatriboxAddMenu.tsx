'use client';

import { useState } from 'react';
import { MB_CATALOG, type MbResolvedBlock } from '@pocket-master/core';
import { parseMbModelValue } from '@/lib/matriboxLook';
import { mbMenuModels, mbMenuModules } from '@/lib/matriboxMenus';
import { PickerList } from './ModelPicker';
import { ModuleIcon } from './ModuleIcon';
import { useI18n } from './I18n';

interface Props {
  userSlot: (block: Pick<MbResolvedBlock, 'module' | 'fxid'>) => string | undefined;
  isInside: (target: Node) => boolean;
  onClose: (refocus: boolean) => void;
  onAdd: (moduleIndex: number, fxid: number) => void;
}

const BACK = 'back';

/**
 * The "add block" menu, in two steps: the block type (module, with its drawing and colour), then
 * that module's models grouped by type. Escape or "Back" returns to the types.
 */
export function MatriboxAddMenu({ userSlot, isInside, onClose, onAdd }: Props) {
  const { t } = useI18n();
  const modules = mbMenuModules(MB_CATALOG);
  const [chosen, setChosen] = useState<number | null>(null);
  // The type the models step went back from: highlighted again on the types.
  const [left, setLeft] = useState<number | null>(null);
  const mod = modules.find((m) => m.index === chosen);
  const back = () => {
    setLeft(chosen);
    setChosen(null);
  };

  if (!mod) {
    const options = modules.map((m) => ({
      value: String(m.index),
      name: m.name,
      icon: (
        <span className={`mb-pick-icon mb-${m.key}`}>
          <ModuleIcon blockKey={m.key} size={22} />
        </span>
      ),
    }));
    return (
      <PickerList
        key="types"
        groups={[{ name: null, options }]}
        value=""
        initial={left === null ? undefined : String(left)}
        ariaLabel={t('mb.addType')}
        isInside={isInside}
        onClose={onClose}
        onChoose={(v) => setChosen(Number(v))}
      />
    );
  }

  const models = mbMenuModels(MB_CATALOG, mod.index, {
    other: t('block.otherModels'),
    userName: (fxid) => userSlot({ module: mod.name, fxid }),
  });
  const backGroup = { name: null, options: [{ value: BACK, name: `‹ ${t('mb.addBack')}` }] };
  return (
    <PickerList
      key={`models-${mod.index}`}
      groups={[backGroup, ...models]}
      value=""
      ariaLabel={t('mb.addModel', { module: mod.name })}
      isInside={isInside}
      // Escape goes back a step; Tab or a press outside closes the menu.
      onClose={(refocus) => (refocus ? back() : onClose(false))}
      onChoose={(v) => {
        if (v === BACK) return back();
        const model = parseMbModelValue(v);
        onClose(true);
        if (model) onAdd(model.moduleIndex, model.fxid);
      }}
    />
  );
}
