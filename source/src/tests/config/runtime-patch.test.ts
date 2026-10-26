import { describe, expect, it } from 'vitest';
import { createConfigRegistry } from '@config/config-registry';
import { applyRuntimePatch, validateRuntimePatch } from '@config/runtime-patch';

const registryResult = createConfigRegistry();
if (!registryResult.ok) {
  throw new Error('基础配置未通过验证，无法测试调参补丁。');
}
const base = registryResult.value.config;

describe('运行时调参补丁', () => {
  it('覆盖卡牌与敌人的可平衡数值', () => {
    const patched = applyRuntimePatch(base, {
      cardStats: { 'three_kingdoms.character.shu_zhong_meng_shi': { basePower: 30 } },
      enemyStats: { 'three_kingdoms.enemy.huang_jin_jun_zhen': { maxHp: 1500 } },
    });

    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.value.cards.get('three_kingdoms.character.shu_zhong_meng_shi')?.basePower).toBe(30);
    expect(patched.value.enemies.get('three_kingdoms.enemy.huang_jin_jun_zhen')?.maxHp).toBe(1500);
    expect(base.cards.get('three_kingdoms.character.shu_zhong_meng_shi')?.basePower).toBe(20);
  });

  it('覆盖平衡与表现参数', () => {
    const patched = applyRuntimePatch(base, {
      balance: { morale: { powerPerPoint: 7 }, economy: { rerollCost: 2 } },
      presentation: { animationEnabled: false },
    });
    expect(patched.ok).toBe(true);
    if (!patched.ok) return;
    expect(patched.value.morale.powerPerPoint).toBe(7);
    expect(patched.value.economy.rerollCost).toBe(2);
    expect(patched.value.presentation.animation.enabled).toBe(false);
  });

  it('引用不存在的定义时给出明确的拒绝路径', () => {
    const result = applyRuntimePatch(base, { cardStats: { 'three_kingdoms.character.not_exist': { basePower: 1 } } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.path).toBe('cardStats.three_kingdoms.character.not_exist');
    }
  });

  it('结构性字段没有补丁入口，尝试写入 ID 会被拒绝', () => {
    const result = validateRuntimePatch({
      cards: [{ id: 'three_kingdoms.character.shu_zhong_meng_shi', cardType: 'weapon' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.message).toContain('结构性配置不可热更新');
    }
  });

  it('尝试以补丁改写卡牌类型或效果类型同样被拒绝', () => {
    const result = validateRuntimePatch({
      cardStats: { 'three_kingdoms.character.shu_zhong_meng_shi': { cardType: 'weapon' } },
    });
    expect(result.ok).toBe(false);
  });
});
