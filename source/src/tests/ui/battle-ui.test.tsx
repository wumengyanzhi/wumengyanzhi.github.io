import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { createGameController, type GameController } from '@app/game-controller';
import { createConfigRegistry } from '@config/config-registry';
import type { CardDefinitionConfig } from '@config/schemas/card.schema';
import type { InstanceId } from '@domain/models/ids';
import type { GameState } from '@domain/state/game-state';
import { createMemoryStorage } from '@infra/testing/memory-storage';
import { createSeededRng } from '@infra/rng/seeded-rng';

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('测试配置无效');
const registry = loaded.value;

afterEach(cleanup);

type CardType = CardDefinitionConfig['cardType'];

interface Harness {
  readonly controller: GameController;
  readonly current: () => GameState;
  readonly inHand: (cardType: CardType) => readonly InstanceId[];
  readonly stage: (instanceId: InstanceId, slotIndex: number) => void;
}

function isDisabled(node: HTMLElement): boolean {
  return (node as HTMLButtonElement).disabled === true;
}

/**
 * 固定开局种子。
 *
 * 界面测试走真实点击，而默认开局是随机种子，起手八张里可能一张兵器都没有，
 * 「人物配兵器」这类断言就会随机挂。种子固定后手牌组成确定，用例之间也不互相影响。
 */
const FIXED_SEED = 'ui-battle-fixed';

/** 开一局并把界面停在战斗幕；随后所有断言都走真实点击，不走控制器后门。 */
function boot(seed: string = FIXED_SEED): Harness {
  const controller = createGameController({ registry, storage: createMemoryStorage(), rng: createSeededRng() });
  render(<App controller={controller} registry={registry} runSeed={() => seed} />);
  fireEvent.click(screen.getByRole('button', { name: '新开冒险' }));

  return {
    controller,
    current: () => {
      const state = controller.state;
      if (state === null) throw new Error('本局未创建');
      return state;
    },
    inHand: (cardType) => {
      const state = controller.state;
      if (state === null) return [];
      return state.zones.hand.filter((id) => {
        const instance = state.cards[id];
        return instance !== undefined && registry.getCardDefinition(instance.definitionId)?.cardType === cardType;
      });
    },
    stage: (instanceId, slotIndex) => {
      const state = controller.state;
      if (state === null) return;
      fireEvent.click(screen.getAllByTestId('hand-card')[state.zones.hand.indexOf(instanceId)]!);
      fireEvent.click(screen.getAllByTestId('play-slot')[slotIndex]!);
    },
  };
}

describe('出牌框与相邻关系', () => {
  it('未选中手牌时空位不可点，选中后可放入', () => {
    const app = boot();
    expect(isDisabled(screen.getAllByTestId('play-slot')[0]!)).toBe(true);

    fireEvent.click(screen.getAllByTestId('hand-card')[0]!);
    expect(isDisabled(screen.getAllByTestId('play-slot')[0]!)).toBe(false);

    fireEvent.click(screen.getAllByTestId('play-slot')[0]!);
    expect(app.current().zones.playSlots[0]).not.toBeNull();
  });

  it('中间留空即隔断相邻，两侧连线都标出「隔断」', () => {
    const app = boot();
    const characters = app.inHand('character');
    expect(characters.length).toBeGreaterThanOrEqual(2);

    app.stage(characters[0]!, 0);
    app.stage(characters[1]!, 2);

    expect(within(screen.getByTestId('play-link-0')).getByText('隔断')).toBeTruthy();
    expect(within(screen.getByTestId('play-link-1')).getByText('隔断')).toBeTruthy();
  });

  it('人物与兵器相邻时，连营线显示匹配档位与对应增幅', () => {
    const app = boot();
    const weapons = app.inHand('weapon');
    expect(weapons.length).toBeGreaterThan(0);
    app.stage(app.inHand('character')[0]!, 0);
    app.stage(weapons[0]!, 1);

    const link = within(screen.getByTestId('play-link-0'));
    expect(['本职', '可用', '偏门', '不匹配'].some((label) => link.queryByText(label) !== null)).toBe(true);
  });

  it('两张同为人物相邻时，连线不含增幅加成', () => {
    const app = boot();
    const characters = app.inHand('character');
    expect(characters.length).toBeGreaterThanOrEqual(2);

    app.stage(characters[0]!, 0);
    app.stage(characters[1]!, 1);

    expect(within(screen.getByTestId('play-link-0')).getByText('相邻')).toBeTruthy();
  });
});

describe('伤害预览', () => {
  it('预览里的每组数字都取自领域本次结算结果', () => {
    const app = boot();
    app.stage(app.inHand('character')[0]!, 0);
    app.stage(app.inHand('weapon')[0]!, 1);

    const preview = app.controller.previewDamage();
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const panel = screen.getByRole('complementary', { name: '伤害预览' });
    expect(within(panel).getByText(preview.value.powerTotal.toLocaleString('zh-CN'))).toBeTruthy();
    expect(within(panel).getByText(preview.value.ampTotal.toLocaleString('zh-CN'))).toBeTruthy();
    expect(within(panel).getByText(preview.value.damage.toLocaleString('zh-CN'))).toBeTruthy();
    expect(within(panel).getByText(Math.max(0, preview.value.enemyHpAfter).toLocaleString('zh-CN'))).toBeTruthy();
  });

  it('出牌框为空时结算按钮不可点', () => {
    boot();
    const panel = screen.getByRole('complementary', { name: '伤害预览' });
    expect(isDisabled(within(panel).getByRole('button', { name: '出战结算' }))).toBe(true);
  });
});

describe('兵器配属', () => {
  it('兵器两侧都是人物时先要指定归属，指定后才能结算', () => {
    const app = boot();
    const characters = app.inHand('character');
    const weapon = app.inHand('weapon')[0]!;
    expect(characters.length).toBeGreaterThanOrEqual(2);

    app.stage(characters[0]!, 0);
    app.stage(weapon, 1);
    app.stage(characters[1]!, 2);

    fireEvent.click(screen.getByRole('button', { name: /指定兵器归属/ }));

    const dialog = screen.getByRole('dialog', { name: '兵器配属' });
    const options = [...dialog.querySelectorAll('button.target-option')];
    expect(options).toHaveLength(2);
    fireEvent.click(options[0] as HTMLElement);

    expect(app.current().equipmentTargets[weapon]).toBeDefined();
    expect(isDisabled(screen.getByRole('button', { name: '出战结算' }))).toBe(false);
  });

  it('指定过一次后，再往框里加牌或拿走不相干的牌，都不必重新指定', () => {
    const app = boot();
    const characters = app.inHand('character');
    const weapon = app.inHand('weapon')[0]!;
    expect(characters.length).toBeGreaterThanOrEqual(2);

    app.stage(characters[0]!, 0);
    app.stage(weapon, 1);
    app.stage(characters[1]!, 2);
    fireEvent.click(screen.getByRole('button', { name: /指定兵器归属/ }));
    fireEvent.click(screen.getByRole('dialog', { name: '兵器配属' }).querySelector('button.target-option') as HTMLElement);

    // 第四格再摆一张不相干的牌：配属继续作数，不该再弹出指定提示。
    const extra = app.current().zones.hand[0]!;
    app.stage(extra, 3);
    expect(app.current().equipmentTargets[weapon]).toBeDefined();
    expect(screen.queryByRole('button', { name: /指定兵器归属/ })).toBeNull();
    expect(isDisabled(screen.getByRole('button', { name: '出战结算' }))).toBe(false);

    // 再把它拿下来，同样不该要求重新指定。
    fireEvent.click(screen.getAllByTestId('play-slot')[3]!);
    expect(app.current().equipmentTargets[weapon]).toBeDefined();
    expect(screen.queryByRole('button', { name: /指定兵器归属/ })).toBeNull();
  });
});

describe('类型与相性标识', () => {
  it('每张手牌都在卡面上标出人物／武器／战术', () => {
    boot();
    const cards = screen.getAllByTestId('hand-card');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const type = card.querySelector('.card__type')?.textContent ?? '';
      expect(['人物', '武器', '战术']).toContain(type);
    }
  });

  it('选中人物后，手牌里的兵器标出匹配档位与增幅', () => {
    const app = boot();
    const weapons = app.inHand('weapon');
    const characters = app.inHand('character');
    expect(weapons.length).toBeGreaterThan(0);
    expect(characters.length).toBeGreaterThan(0);

    const index = app.current().zones.hand.indexOf(characters[0]!);
    fireEvent.click(screen.getAllByTestId('hand-card')[index]!);

    const pairs = screen.getAllByTestId('card-pair');
    expect(pairs).toHaveLength(weapons.length);
    for (const pair of pairs) {
      expect(pair.textContent ?? '').toMatch(/^(本职|可用|偏门|不匹配)/);
    }
  });

  it('兵器卡面自带「谁来用最合适」的速查行', () => {
    const app = boot();
    const weapons = app.inHand('weapon');
    expect(weapons.length).toBeGreaterThan(0);

    const index = app.current().zones.hand.indexOf(weapons[0]!);
    const card = screen.getAllByTestId('hand-card')[index]!;
    expect(card.querySelector('.card__match')?.textContent ?? '').toMatch(/\+/);
  });
});

describe('卡牌详情与弃牌', () => {
  it('详情把威力的四层来源摊开显示', () => {
    boot();
    fireEvent.click(screen.getAllByRole('button', { name: /^查看 / })[0]!);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('当前数值')).toBeTruthy();
    expect(within(dialog).getByText('威力合计')).toBeTruthy();
    expect(within(dialog).getByText('基础威力')).toBeTruthy();
    expect(within(dialog).getByText('军势')).toBeTruthy();
  });

  it('标记弃牌后弃掉，被弃的牌离开手牌且手牌补满', () => {
    const app = boot();
    const first = app.current().zones.hand[0]!;
    fireEvent.click(screen.getAllByRole('button', { name: /^标记弃牌：/ })[0]!);
    fireEvent.click(screen.getByRole('button', { name: '弃掉所选并补牌' }));

    expect(app.current().zones.hand).not.toContain(first);
    expect(app.current().zones.hand).toHaveLength(8);
  });
});
