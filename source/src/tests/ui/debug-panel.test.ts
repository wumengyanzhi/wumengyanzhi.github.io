import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createConfigRegistry } from '@config/config-registry';
import { applyRuntimePatch, validateRuntimePatch } from '@config/runtime-patch';
import {
  TIMING_TEXT,
  buildCatalog,
  effectiveValue,
  pathText,
  searchCatalog,
  type ConfigEntry,
} from '@ui/debug/config-search';
import {
  createPatchState,
  exportPatch,
  importPatch,
  parseEntryValue,
  resetAll,
  setEntryValue,
  undoLast,
} from '@ui/debug/patch-store';

/**
 * 开发期调参面板的验收。
 *
 * 这个面板是「改数值不写代码」的入口，因此它自己必须守三条底线：
 * 改出来的数真的进了有效配置、改错了能退回去、以及它绝不能出现在生产包里。
 * 前两条用纯函数断言——撤销栈与补丁写入都不依赖 DOM；最后一条直接读构建产物。
 */

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const config = loaded.value.config;
const catalog = buildCatalog(config);

const WEAPON_ID = 'three_kingdoms.weapon.huan_shou_dao';

function entryOf(path: string): ConfigEntry {
  const entry = catalog.find((candidate) => pathText(candidate) === path);
  if (entry === undefined) throw new Error(`目录里没有这一项：${path}`);
  return entry;
}

const weaponPower = entryOf(`cardStats.${WEAPON_ID}.basePower`);
const cardType = catalog.find((candidate) => candidate.id === `card.${WEAPON_ID}.cardType`);

describe('调参面板', () => {
  it('改一次后有效值跟着变，撤销一次就回到基础值', () => {
    let state = createPatchState();
    expect(effectiveValue(weaponPower, state.patch)).toBe(weaponPower.base);

    state = setEntryValue(state, weaponPower, '35');
    expect(effectiveValue(weaponPower, state.patch)).toBe(35);

    state = undoLast(state);
    expect(effectiveValue(weaponPower, state.patch)).toBe(weaponPower.base);
  });

  it('改出来的补丁真的进到有效配置里，且不动基础配置', () => {
    const state = setEntryValue(createPatchState(), weaponPower, '35');
    const applied = applyRuntimePatch(config, state.patch);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    expect(applied.value.cards.get(WEAPON_ID)?.basePower).toBe(35);
    // 基础配置是只读的基准，补丁只能在它之上合成新对象。
    expect(config.cards.get(WEAPON_ID)?.basePower).toBe(weaponPower.base);
  });

  it('结构性字段只标「需重新加载内容」，并且改不动', () => {
    const structural = catalog.filter((entry) => !entry.patchable);
    expect(structural.length).toBeGreaterThan(0);
    for (const entry of structural) {
      expect(entry.timing).toBe('reload');
      expect(TIMING_TEXT[entry.timing]).toBe('需重新加载内容');
    }

    if (cardType === undefined) throw new Error('缺少结构性字段样本');
    const state = setEntryValue(createPatchState(), cardType, 'character');
    expect(state.rejections.length).toBeGreaterThan(0);
    expect(state.patch).toEqual({});
  });

  it('超出范围、非数字、空值都被挡下，补丁保持原样', () => {
    for (const raw of ['-1', 'abc', '']) {
      const state = setEntryValue(createPatchState(), weaponPower, raw);
      expect(state.rejections.length).toBeGreaterThan(0);
      expect(state.patch).toEqual({});
    }
    expect(parseEntryValue(weaponPower, '7').ok).toBe(true);
  });

  it('撤销栈是「单次修改」粒度，连改三次要退三次', () => {
    let state = createPatchState();
    state = setEntryValue(state, weaponPower, '11');
    state = setEntryValue(state, weaponPower, '22');
    state = setEntryValue(state, weaponPower, '33');
    expect(effectiveValue(weaponPower, state.patch)).toBe(33);

    state = undoLast(state);
    expect(effectiveValue(weaponPower, state.patch)).toBe(22);
    state = undoLast(state);
    expect(effectiveValue(weaponPower, state.patch)).toBe(11);
    state = undoLast(state);
    expect(effectiveValue(weaponPower, state.patch)).toBe(weaponPower.base);
    expect(state.history).toHaveLength(0);
  });

  it('恢复全部默认一次清空所有覆盖', () => {
    let state = createPatchState();
    state = setEntryValue(state, weaponPower, '35');
    state = setEntryValue(state, entryOf('balance.damage.baseAmp'), '3');
    expect(exportPatch(state)).not.toBe('{}');

    state = resetAll();
    expect(state.patch).toEqual({});
    expect(state.history).toHaveLength(0);
  });

  it('导出—导入往返一致，导入非法补丁被明确拒绝', () => {
    const state = setEntryValue(createPatchState(), weaponPower, '35');
    const text = exportPatch(state);

    const restored = importPatch(createPatchState(), text);
    expect(restored.rejections).toHaveLength(0);
    expect(restored.patch).toEqual(state.patch);

    const broken = importPatch(createPatchState(), '{ 不是 JSON');
    expect(broken.rejections.length).toBeGreaterThan(0);

    const structural = importPatch(
      createPatchState(),
      JSON.stringify({ cardStats: { [WEAPON_ID]: { cardType: 'character' } } }),
    );
    expect(structural.rejections.length).toBeGreaterThan(0);
    expect(structural.patch).toEqual({});
  });

  it('搜索能按字段路径、卡名与分组命中', () => {
    expect(searchCatalog(catalog, 'basePower').length).toBeGreaterThan(0);
    expect(searchCatalog(catalog, '环首刀').every((entry) => entry.owner === '环首刀')).toBe(true);
    const byPath = searchCatalog(catalog, 'balance.morale');
    expect(byPath.length).toBeGreaterThan(0);
    expect(byPath.every((entry) => pathText(entry).startsWith('balance.morale'))).toBe(true);
    expect(searchCatalog(catalog, '')).toHaveLength(catalog.length);
  });

  it('生效时机分成三档，战斗与牌区类字段不会标成立即生效', () => {
    const timingOf = (path: string): string => entryOf(path).timing;
    expect(timingOf(`cardStats.${WEAPON_ID}.basePower`)).toBe('immediate');
    expect(timingOf('balance.damage.baseAmp')).toBe('immediate');
    expect(timingOf('balance.battle.playCount')).toBe('next_battle');
    expect(timingOf('enemyStats.three_kingdoms.enemy.huang_jin_jun_zhen.maxHp')).toBe('next_battle');
    // 格数决定牌区结构，改了必须重开，不能算下一场。
    expect(timingOf('balance.battle.playSlotCount')).toBe('reload');
  });

  it('补丁 Schema 拒绝任何结构性入口', () => {
    const rejected = validateRuntimePatch({ cards: { [WEAPON_ID]: { cardType: 'character' } } });
    expect(rejected.ok).toBe(false);
  });
});

describe('正式构建剥离', () => {
  it('生产构建产物里没有调参面板的代码与样式', () => {
    /*
     * 真跑一次生产构建再读产物。
     * 两点必须这样：npm 在 Windows 上是 .cmd，execFileSync 拉不起来；
     * 而 vite 的 build() API 若在 vitest 进程内调用，会带上 dev 模式，
     * import.meta.env.DEV 就还是 true，面板会被正常打进 chunk，断言失去意义。
     */
    execFileSync(
      process.execPath,
      [resolve(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'error'],
      {
        cwd: process.cwd(),
        stdio: 'pipe',
        // vitest 把 NODE_ENV 设成 test，vite 据此判定非生产，DEV 就会是 true，
        // 面板于是被正常打包——必须显式按生产环境跑，这次构建才等价于 npm run build。
        env: { ...process.env, NODE_ENV: 'production' },
      },
    );

    const assetDir = resolve(process.cwd(), 'dist/assets');
    const bundles = readdirSync(assetDir).filter((name) => name.endsWith('.js'));
    expect(bundles.length).toBeGreaterThan(0);

    for (const name of bundles) {
      const text = readFileSync(resolve(assetDir, name), 'utf8');
      expect(text).not.toContain('调参面板');
      expect(text).not.toContain('tuner__scrim');
      expect(text).not.toContain('diff__chip');
    }
  }, 180_000);
});
