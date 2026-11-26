'use client';

/**
 * Development sheet of the rig view's gear drawings: every kind, three models each, for design
 * review. The route renders nothing in production builds.
 */
import { RigIcon } from '@/components/rig/RigIcon';
import { RIG_CATEGORIES, rigIconSpec } from '@/lib/rigIcon';

const VARIANTS = [
  { id: '1:16', params: 2, name: '1x12' },
  { id: '7:42', params: 4, name: '2x12' },
  { id: '11:3', params: 6, name: '4x10' },
];

export default function RigIcons() {
  if (process.env.NODE_ENV === 'production') return null;
  return (
    <main className="rig rig-sheet">
      {RIG_CATEGORIES.map((category) => (
        <section key={category} className="rig-sheet-row" aria-label={category}>
          <h2>{category}</h2>
          <div className="rig-sheet-icons">
            {VARIANTS.map((v) => (
              <RigIcon key={v.id} spec={rigIconSpec(category, v.id, v.params, v.name)} size={64} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
