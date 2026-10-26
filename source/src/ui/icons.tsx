import type { ReactElement } from 'react';
import type { Profession, WeaponClass } from '@domain/models/enums';

/**
 * 徽记。
 *
 * 全部内联 SVG，不引入任何图片资源；线条只用 stroke，方便跟随当前文字色。
 * 每种职业和每种兵器各一个字形，玩家不看文字也能分辨卡面类型。
 */

const GLYPH_PATHS: Readonly<Record<string, readonly string[]>> = {
  warrior: ['M12 4 L15 9 L12 12 L9 9 Z', 'M12 12 V20', 'M8 15 H16'],
  archer: ['M8 4 C15 9 15 15 8 20', 'M8 4 V20', 'M4.5 12 H19', 'M16 9 L19 12 L16 15'],
  strategist: ['M6 8 H18', 'M6 12 H18', 'M6 16 H18'],
  assassin: ['M6 18 L16 8', 'M12.5 7.5 L16.5 11.5', 'M10.5 9.5 L14.5 13.5'],
  guard: ['M12 4 L19 7 V12 Q19 17 12 20 Q5 17 5 12 V7 Z', 'M12 8 V15'],
  blade: ['M8 20 V14', 'M5 14 H11', 'M8 14 C11 8 14.5 4 20 4', 'M16.5 4.5 L20 4 L19.5 7.5'],
  spear: ['M12 4 L15 9.5 L12 12.5 L9 9.5 Z', 'M12 12.5 V20'],
  bow: ['M8 4 C15 9 15 15 8 20', 'M8 4 V20'],
  implement: [
    'M12 20 V12',
    'M12 12 L6 8',
    'M12 12 L9 5.5',
    'M12 12 L12 4',
    'M12 12 L15 5.5',
    'M12 12 L18 8',
  ],
  hidden: ['M7 3.5 V10.5', 'M3.5 7 H10.5', 'M16 13.5 V20.5', 'M12.5 16.5 H19.5'],
  tactic: ['M8 3.5 V20.5', 'M8 5 H18 L15 9 L18 13 H8'],
};

export type CardGlyphKind = Profession | WeaponClass | 'tactic';

export function CardGlyph({ kind }: { readonly kind: CardGlyphKind }): ReactElement {
  const paths = GLYPH_PATHS[kind] ?? [];
  return (
    <svg viewBox="0 0 24 24" role="presentation" focusable="false" aria-hidden="true">
      {paths.map((path, index) => (
        <path
          key={index}
          d={path}
          fill="none"
          stroke="var(--type-color, currentColor)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

export function ArrowGlyph(): ReactElement {
  return (
    <svg viewBox="0 0 34 12" role="presentation" focusable="false" aria-hidden="true">
      <path
        d="M1 6 H25 M20 2 L26 6 L20 10"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
