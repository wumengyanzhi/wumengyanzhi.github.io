import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** vitest 从项目根跑，这里按仓库根拼路径，不依赖 import.meta.url 的协议。 */
const tokensCss = readFileSync(resolve(process.cwd(), 'src/ui/styles/tokens.css'), 'utf8');

/**
 * 高度预算守门。
 *
 * 四段的高度不是写死的：顶栏与底栏固定，出牌框按内容取高，手牌吃掉剩下的空间，
 * 各自都有一个下限。矮屏只要「四段下限之和 ≤ 视口」就不会裁底栏、不会整屏滚动。
 * 这里直接从 token 里读数字算总账，改尺寸的人当场知道超在哪里。
 *
 * 视口取 720 / 660 / 600 / 560 四档：每一档都落在一个不同的 media 分支上，
 * 谁把某一档的下限调高了，对应的断言立刻失败。
 */

/** 兵器待指定的提示条可能额外占一行，预算里必须留出位置。 */
const BANNER_ALLOWANCE = 44;
/**
 * 顶栏按内容取高，令牌只是下限；两行 chip 的资源条实测约 88px。
 * 预算按「令牌与实测取大」算，顶栏一旦被塞回第三行内容，这里立刻报警。
 */
const TOPBAR_CONTENT = 88;
/** 格内文字安全区：名称 + 类型/相性 + 威力增幅三行加内边距，图形被压到最小也要留得住。 */
const SLOT_TEXT_SAFE = 126;

type TokenSet = Readonly<Record<string, number>>;

function sliceAfter(css: string, marker: string, endMarker: string): string {
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`找不到 ${marker}`);
  const body = css.slice(start + marker.length);
  const end = body.indexOf(endMarker);
  return end < 0 ? body : body.slice(0, end);
}

function parseTokens(css: string): TokenSet {
  const tokens: Record<string, number> = {};
  for (const match of css.matchAll(/--([\w-]+):\s*(-?\d+(?:\.\d+)?)px/g)) {
    tokens[match[1]!] = Number(match[2]);
  }
  return tokens;
}

function merge(base: TokenSet, override: TokenSet): TokenSet {
  return { ...base, ...override };
}

/** 四段下限之和减去视口高度：≤ 0 表示放得下。 */
function budget(tokens: TokenSet, viewHeight: number): number {
  const pad = tokens['shell-pad'] ?? 0;
  const gap = tokens['band-gap'] ?? 0;
  const topbar = Math.max(tokens['topbar-h'] ?? 0, TOPBAR_CONTENT);
  const bands = topbar
    + (tokens['field-min-h'] ?? 0)
    + (tokens['hand-min-h'] ?? 0)
    + (tokens['foot-h'] ?? 0);
  return pad * 2 + bands + gap * 3 + BANNER_ALLOWANCE - viewHeight;
}

const baseTokens = parseTokens(sliceAfter(tokensCss, ':root {', '@media (max-height: 820px)'));
const compactTokens = merge(
  baseTokens,
  parseTokens(sliceAfter(tokensCss, '@media (max-height: 820px)', '@media (max-height: 700px)')),
);
const short700 = merge(
  compactTokens,
  parseTokens(sliceAfter(tokensCss, '@media (max-height: 700px)', '@media (max-height: 620px)')),
);
const short620 = merge(
  short700,
  parseTokens(sliceAfter(tokensCss, '@media (max-height: 620px)', '@media (max-width')),
);

/** media 是叠加生效的：视口越矮命中的分支越多，这里按同一顺序叠。 */
function tierFor(viewHeight: number): TokenSet {
  if (viewHeight <= 620) return short620;
  if (viewHeight <= 700) return short700;
  if (viewHeight <= 820) return compactTokens;
  return baseTokens;
}

const VIEWPORTS = [720, 660, 600, 560] as const;

describe('分辨率预算', () => {
  it.each(VIEWPORTS)('%i 高的窗口放得下四段下限，不裁底栏也不整屏滚动', (viewHeight) => {
    expect(budget(tierFor(viewHeight), viewHeight)).toBeLessThanOrEqual(0);
  });

  it('标准档在 1440×900 内放得下', () => {
    expect(budget(baseTokens, 900)).toBeLessThanOrEqual(0);
  });

  it.each(VIEWPORTS)('%i 档的格位仍留得住完整文字行', (viewHeight) => {
    const tokens = tierFor(viewHeight);
    expect(tokens['slot-h'] ?? 0).toBeGreaterThanOrEqual(SLOT_TEXT_SAFE);
    // 出牌框下限必须容得下一整格加表头，否则矮屏会把格子裁掉。
    expect(tokens['field-min-h'] ?? 0).toBeGreaterThanOrEqual((tokens['slot-h'] ?? 0) + 30);
  });

  it('手牌下限高到能放下卡面与按钮条', () => {
    for (const viewHeight of VIEWPORTS) {
      expect(tierFor(viewHeight)['hand-min-h'] ?? 0).toBeGreaterThanOrEqual(150);
    }
  });

  it('手牌卡有高度上限，长窗口不会顶破边框', () => {
    for (const viewHeight of VIEWPORTS) {
      expect(tierFor(viewHeight)['card-max-h'] ?? 0).toBeGreaterThan(120);
      expect(tierFor(viewHeight)['card-max-h'] ?? 0).toBeLessThanOrEqual(240);
    }
  });
});
