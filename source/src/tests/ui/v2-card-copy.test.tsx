import { cleanup, fireEvent, render, screen, within, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARDS, CARD_MAP } from '../../v2/data';
import { AUTOMATIC_EQUIPMENT_TEXT, CARD_SKILL_NAMES, getCardRuleText, getCardSkillName } from '../../v2/ui/card-copy';
import { CardDetail, CardFace, SKILL_TEXT } from '../../v2/ui/primitives';
import { CardInspector } from '../../v2/ui/card-inspector';
import type { CardInstance } from '../../v2/model';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const card = (suffix: string) => CARDS.find(definition => definition.id.endsWith(`.${suffix}`))!;

describe('card skill copy', () => {
  it('covers the shipped native skills and gives plain cards no invented skill or rule', () => {
    expect(Object.keys(CARD_SKILL_NAMES).sort()).toEqual([...new Set(CARDS.filter(definition => definition.skill).map(definition => definition.skill))].sort());
    for (const definition of CARDS) {
      if (definition.skill) {
        expect(getCardSkillName(definition)).toMatch(/^[\u4e00-\u9fff]{2,6}$/);
        expect(getCardRuleText(definition).length).toBeGreaterThan(12);
      } else {
        expect(getCardSkillName(definition)).toBe('');
        expect(getCardRuleText(definition)).toBe('');
      }
    }
  });
  it('describes the two automated weapon choices and their tie rules', () => {
    const temper = getCardRuleText(card('xia_hou_dun'));
    expect(temper).toContain('每场限一次');
    expect(temper).toContain('结算后');
    expect(temper).toContain('职业加成最高');
    expect(temper).toContain('本局永久威力 +10');
    expect(temper).toContain('同分选靠左');
    const twin = getCardRuleText(card('zhao_yun'));
    expect(twin).toContain('同时装备两件');
    expect(twin).toContain('有效威力翻倍');
    expect(twin).toContain('有效增幅翻倍');
    expect(twin).toContain('本次伤害较高');
    expect(twin).toContain('同分时左侧兵器威力翻倍');
    expect(AUTOMATIC_EQUIPMENT_TEXT).toContain('不跨空格');
    expect(AUTOMATIC_EQUIPMENT_TEXT).toContain('无相邻人物');
  });
  it('retains delayed chain, optional hand cost, growth scope and removal conditions', () => {
    const chain = getCardRuleText(card('pang_tong'));
    expect(chain).toContain('结算后');
    expect(chain).toContain('该实体本场下次成功出战');
    expect(chain).toContain('额外结算一次');
    expect(chain).toContain('随后移除连环');
    expect(chain).toContain('手牌已满则进入弃牌堆');
    const cost = getCardRuleText(card('sun_shang_xiang'));
    expect(cost).toContain('手牌中的一件兵器置入弃牌堆');
    expect(cost).toContain('基础威力与本局永久威力之和');
    expect(cost).toContain('不指定则不消耗');
    expect(getCardRuleText(card('guan_yu'))).toContain('每累计获得 20 点本局永久威力');
    expect(getCardRuleText(card('zhou_yu'))).toContain('本场临时威力 +20');
    const swallow = getCardRuleText(card('lv_bu'));
    expect(swallow).toContain('右侧直接相邻');
    expect(swallow).toContain('记录');
    expect(swallow).toContain('战斗胜利时');
    expect(swallow).toContain('若目标尚未进入本局移除区');
  });
  it.each([
    ['zhen_jun_yi_dao', ['每场限一次，本局最多三次', '结算后', '配属武者', '本局永久威力 +10']],
    ['zhui_feng_diao_gong', ['本场每主动弃牌一次', '+15', '最多 +45']],
    ['wu_xing_zhen_pan', ['每有一张战术', '+1', '最多 +3']],
    ['bing_ren_qi_ju', ['每有一件兵器', '+10', '最多 +30']],
    ['jun_shi_ru_hong', ['1 点当前军势', '+5', '最多 +25']],
    ['lei_gu_jin_jun', ['每有一名人物', '+5', '最多 +20']],
    ['ben_zhi_xie_zhen', ['实际装备其本职兵器', '+2', '最多 +6']],
    ['xu_shi_xiang_sheng', ['其他威力型战术', '+2', '最多 +4']],
    ['duan_liang_qi_xi', ['本场主动弃掉', '不同类型', '+15', '最多 +45']],
    ['hou_jun_ya_zhen', ['剩余手牌', '+1', '最多 +4']],
  ])('keeps the real limits for %s', (suffix, requirements) => {
    const text = getCardRuleText(card(suffix as string));
    for (const requirement of requirements as string[]) expect(text).toContain(requirement);
  });
  it('uses the same full rule in modal and hover details, including enhancement effects', () => {
    vi.useFakeTimers();
    const definition = CARD_MAP['three_kingdoms.character.xia_hou_dun']!;
    const instance: CardInstance = { id: 'inspected', definitionId: definition.id, permanentPower: 0, permanentAmp: 0, temporaryPower: 0, temporaryAmp: 0, used: [], plays: 0, chain: true, enhancementSkills: ['xian_deng'], growthRemainder: 0 };
    const { container } = render(<><CardDetail definition={definition} instance={instance} /><CardInspector cards={{ inspected: instance }} holdMs={300} contextKey="copy"><button><CardFace definition={definition} instance={instance} /></button></CardInspector></>);
    expect(container.querySelector('.v2-rule-text')?.textContent).toBe(getCardRuleText(definition));
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Tab' });
    fireEvent.focus(screen.getByRole('button'));
    act(() => vi.advanceTimersByTime(1));
    const info = screen.getByRole('tooltip');
    expect(within(info).getByText(getCardRuleText(definition))).toBeTruthy();
    expect(info.textContent).toContain(SKILL_TEXT.xian_deng);
    expect(info.textContent).toContain('本场下次成功出战');
  });
  it('shows no empty native rule paragraph in a plain card tooltip', () => {
    render(<CardInspector holdMs={300} contextKey="plain-copy"><button><CardFace definition={CARDS[0]!} /></button></CardInspector>);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Tab' }); fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('tooltip').querySelector('.v2-inspect-rule')).toBeNull();
    expect(screen.getByRole('tooltip').textContent).not.toContain('无技能');
  });
});
