import type { Ink } from '../../shared/types.ts'

export const INKS: { id: Ink; name: string }[] = [
  { id: 'civit', name: 'Çivit' },
  { id: 'visne', name: 'Vişne' },
  { id: 'yosun', name: 'Yosun' },
  { id: 'hardal', name: 'Hardal' },
  { id: 'murdum', name: 'Mürdüm' },
]

export function InkPicker({ value, onChange, disabled }: { value: Ink; onChange: (ink: Ink) => void; disabled?: Ink }) {
  return (
    <div className="inks" role="radiogroup" aria-label="Mürekkep rengi">
      {INKS.map((ink) => (
        <button
          key={ink.id}
          type="button"
          role="radio"
          aria-checked={value === ink.id}
          className={value === ink.id ? 'ink is-on' : 'ink'}
          disabled={disabled === ink.id}
          title={disabled === ink.id ? `${ink.name} arkadaşında` : ink.name}
          onClick={() => onChange(ink.id)}
        >
          <i style={{ background: `var(--${ink.id})` }} />
          {ink.name}
        </button>
      ))}
    </div>
  )
}
