import { describe, expect, it } from 'vitest';
import { createGameController } from '@app/game-controller';
import { createConfigRegistry } from '@config/config-registry';
import { decodeSave, encodeSave } from '@infra/save-import-export/save-codec';
import { createMemoryStorage } from '@infra/testing/memory-storage';
import { createSeededRng } from '@infra/rng/seeded-rng';

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const registry = loaded.value;

function startedSave(): string {
  const controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
  const started = controller.dispatch({ type: 'NewRun', seed: 'round-trip' });
  if (!started.ok) throw new Error(started.error.message);
  return encodeSave(started.value.state);
}

describe('存档编解码', () => {
  it('导出再导入保持完整状态与下一次 RNG 结果一致', () => {
    const raw = startedSave();
    const decoded = decodeSave(raw, registry);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(JSON.parse(encodeSave(decoded.value.state))).toEqual(JSON.parse(raw));
    const rng = createSeededRng();
    expect(rng.next(decoded.value.state.rng)).toEqual(rng.next(JSON.parse(raw).rng));
  });

  it('拒绝未知存档版本、卡牌实例缺失数值以及错误的五格出牌框', () => {
    const valid = JSON.parse(startedSave());
    const unknown = structuredClone(valid);
    unknown.meta.saveVersion = 99;
    expect(decodeSave(JSON.stringify(unknown), registry).ok).toBe(false);

    const missingStat = structuredClone(valid);
    const firstId = Object.keys(missingStat.cards)[0];
    if (firstId === undefined) throw new Error('测试存档没有卡牌');
    delete missingStat.cards[firstId].permanentPower;
    expect(decodeSave(JSON.stringify(missingStat), registry).ok).toBe(false);

    const shortSlots = structuredClone(valid);
    shortSlots.zones.playSlots.pop();
    expect(decodeSave(JSON.stringify(shortSlots), registry).ok).toBe(false);
  });

  it('将既有版本 1 存档迁移到版本 2，并补上装备目标字段', () => {
    const legacy = JSON.parse(startedSave());
    legacy.meta.saveVersion = 1;
    delete legacy.equipmentTargets;
    const decoded = decodeSave(JSON.stringify(legacy), registry);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.state.meta.saveVersion).toBe(2);
    expect(decoded.value.state.equipmentTargets).toEqual({});
    expect(decoded.value.state.rng).toEqual(legacy.rng);
    expect(decoded.value.state.cards).toEqual(legacy.cards);
    expect(decoded.value.fromVersion).toBe(1);
    expect(decoded.value.appliedMigrations).toEqual(['1→2']);
  });
});
