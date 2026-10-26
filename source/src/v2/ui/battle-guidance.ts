import { getAutomaticSkillTargets, getBattleChoices, getEquipment, getWeaponMatch, canEcho } from '../battle';
import { CARD_MAP } from '../data';
import type { BattleChoice, CardDef, RunState } from '../model';
import { getCardSkillName } from './card-copy';

export interface PairingHint { label: string; best: boolean; }
export function pairingHint(state: RunState, selectedId: string | null, otherId: string): PairingHint | null {
  if (!selectedId || selectedId === otherId || !state.cards[selectedId] || !state.cards[otherId]) return null;
  const selected = CARD_MAP[state.cards[selectedId]!.definitionId]!, other = CARD_MAP[state.cards[otherId]!.definitionId]!;
  const character = selected.type === 'character' && other.type === 'weapon' ? selected : selected.type === 'weapon' && other.type === 'character' ? other : null;
  const weapon = selected.type === 'weapon' ? selected : other;
  if (!character) return null;
  const bonus = getWeaponMatch(character, weapon);
  return { label: bonus > 0 ? `${bonus === 4 ? '本职' : '适配'} · 增幅 +${bonus}` : '可装备 · 无职业加成', best: bonus === 4 };
}

export type SkillCueState = 'ready' | 'waiting' | 'used' | 'choose' | 'optional' | 'passive';
export interface SkillCue {
  id: string; sourceId: string; sourceName: string; name: string; state: SkillCueState;
  message: string; targetIds: string[]; choice?: BattleChoice; caution?: boolean;
}
const ONCE = new Set(['xia_hou_dun', 'zhao_yun', 'zhu_ge_liang', 'pang_tong', 'huang_zhong', 'sun_shang_xiang', 'lv_bu', 'zhen_jun_yi_dao']);
const ENHANCEMENTS: Record<string, string> = { xian_deng: '先登', zhen_jun: '振军', tong_dao: '同道', gu_feng: '孤锋', jun_xu: '军需', hui_xiang: '回响' };

/** Eligibility follows the actual formation; it never changes a target or spends a resource. */
export function battleSkillCues(state: RunState): SkillCue[] {
  const b = state.battle;
  if (!b || state.phase !== 'battle') return [];
  const ids = b.slots.filter((id): id is string => !!id), equipment = getEquipment(state), automatic = getAutomaticSkillTargets(state);
  const definition = (id: string): CardDef => CARD_MAP[state.cards[id]!.definitionId]!;
  const names = (list: string[]) => list.map(id => definition(id).name).join('、');
  const characters = ids.filter(id => definition(id).type === 'character'), weapons = ids.filter(id => definition(id).type === 'weapon'), tactics = ids.filter(id => definition(id).type === 'tactic');
  const tacticNames = new Set(tactics.map(id => definition(id).name));
  const choices = getBattleChoices(state);
  const result: SkillCue[] = [];
  for (const id of ids) {
    const card = state.cards[id]!, d = definition(id), position = b.slots.indexOf(id);
    const neighbors = [b.slots[position - 1], b.slots[position + 1]].filter((other): other is string => !!other);
    const equipped = weapons.filter(weapon => equipment[weapon] === id), owner = equipment[id];
    const primary = equipped.some(weapon => getWeaponMatch(d, definition(weapon)) === 4);
    const cue: SkillCue = { id: `skill:${id}`, sourceId: id, sourceName: d.name, name: getCardSkillName(d), state: 'waiting', message: '', targetIds: [] };
    const mark = (ready: boolean, yes: string, no: string, targets: string[] = []) => { cue.state = ready ? 'ready' : 'waiting'; cue.message = ready ? yes : no; cue.targetIds = targets; };
    const times = 1 + (card.chain ? 1 : 0) + (card.plays === 0 && card.enhancementSkills.includes('hui_xiang') && canEcho(d) ? 1 : 0);
    const power = (amount: number) => `本次威力 +${amount * times}`;
    const amp = (amount: number) => `本次增幅 +${amount * times}`;
    switch (d.skill) {
      case 'shu_zhong_xiao_jiang': case 'ba_shu_shen_she': case 'wei_wu_zhi_shi': case 'jiang_dong_tie_wei': case 'luan_shi_jian_ke':
        mark(primary, power(15), '需要装备一件本职兵器', equipped); break;
      case 'shu_han_mi_shi': mark(position === 0 || position === 4, power(10), '需要位于第 1 或第 5 格'); break;
      case 'hu_wei_su_jiang': mark(neighbors.filter(other => definition(other).type === 'character').length === 2, power(20), '需要左右紧邻人物'); break;
      case 'wei_ying_mi_tan': mark(b.hand.some(other => definition(other).type === 'tactic'), power(15), '需要手牌中保留战术'); break;
      case 'jiang_dong_shen_she': mark(neighbors.length === 1, power(15), '需要恰好紧邻一张牌'); break;
      case 'jiang_dong_zhi_jiang': mark(tactics.length > 0, power(15), '需要与战术一同出战'); break;
      case 'xi_liang_xiao_jiang': mark(ids.length === 2, power(20), '需要本次仅出两张牌'); break;
      case 'sai_wai_shen_she': case 'huang_zhong': mark(b.activeDiscards > 0, power(d.skill === 'huang_zhong' ? 25 : 15), '需要本战主动弃牌至少一次'); break;
      case 'xia_hou_dun': {
        const target = automatic[cue.id];
        mark(!!target, `结算后 ${target ? names([target]) : ''} 本局永久威力 +10`, '需要装备一件兵器', target ? [target] : []); break;
      }
      case 'zhao_yun': {
        const target = automatic[cue.id], other = equipped.find(weapon => weapon !== target);
        mark(equipped.length === 2, `${target ? names([target]) : ''}威力 ×2；${other ? names([other]) : ''}增幅 ×2`, `还需装备 ${Math.max(0, 2 - equipped.length)} 件兵器`, equipped); break;
      }
      case 'zhu_ge_liang': mark(tacticNames.size >= 2, '结算后自身本局永久威力 +15', '需要两张不同名战术共同出战'); break;
      case 'pang_tong': {
        cue.choice = choices.find(choice => choice.key === cue.id);
        const target = b.targets[cue.id] || (tactics.length === 1 ? tactics[0] : undefined);
        mark(!!target, `结算后 ${target ? names([target]) : ''} 获得连环并回手；满手则入弃牌堆`, '点击一张阵中战术作为目标', target ? [target] : []);
        if (!tactics.length) cue.message = '需要一张战术共同出战';
        else if (!target) cue.state = 'choose';
        break;
      }
      case 'sun_shang_xiang': {
        cue.choice = choices.find(choice => choice.key === cue.id);
        const target = b.targets[cue.id];
        if (target && state.cards[target]) {
          cue.state = 'ready'; cue.targetIds = [target]; cue.caution = true;
          cue.message = `将弃置 ${names([target])}，本次威力 +${definition(target).power + state.cards[target]!.permanentPower}`;
        } else {
          cue.state = cue.choice?.options.length ? 'optional' : 'waiting';
          cue.message = cue.choice?.options.length ? '可弃置一件手牌兵器，换取本次威力' : '手牌中没有可弃置的兵器';
        }
        break;
      }
      case 'guan_yu': cue.state = 'passive'; cue.message = `本局永久威力每累计 +20，永久增幅 +1（当前累计 ${card.growthRemainder}/20）`; break;
      case 'cao_cao': cue.state = 'passive'; cue.message = '其他魏国人物强化时，自身本局永久威力 +10'; break;
      case 'zhou_yu': {
        const count = b.hand.filter(other => definition(other).type === 'character' && definition(other).faction === 'wu').length;
        mark(count > 0, `自身本场临时威力 +${count * 20}`, '需要手牌中保留吴国人物'); break;
      }
      case 'lv_bu': {
        const right = b.slots[position + 1], pending = b.swallow.find(intent => intent.sourceId === id);
        const target = pending?.targetId ?? (right && definition(right).type === 'character' ? right : undefined);
        mark(!!target, `胜利后吞噬 ${target ? names([target]) : ''}，目标永久离队`, '需要右侧紧邻一名人物', target ? [target] : []);
        cue.caution = !!target;
        if (pending) { cue.state = 'passive'; cue.message = `已记录：胜利后吞噬 ${names([pending.targetId])}`; }
        break;
      }
      case 'bai_lian_huan_shou_dao': case 'yu_lin_chang_qiang': case 'jun_shi_yu_shan': case 'diao_ling_qiang_gong': case 'yan_wei_xiu_biao':
        mark(!!owner && getWeaponMatch(definition(owner), d) === 4, `${owner ? names([owner]) : ''} ${power(10)}`, '需要自动装备给本职人物', owner ? [owner] : []); break;
      case 'bing_feng_zhan_ma_dao': mark(!!owner && weapons.filter(weapon => equipment[weapon] === owner).length >= 2, amp(1), '所属人物还需另一件兵器'); break;
      case 'zhu_sha_fu_bi': mark(tactics.length > 0, amp(1), '需要战术共同出战'); break;
      case 'lian_zhu_fei_shi': case 'zuo_you_ce_ying': mark(neighbors.filter(other => definition(other).type === 'character').length === 2, amp(d.skill === 'lian_zhu_fei_shi' ? 1 : 2), '需要左右紧邻人物'); break;
      case 'you_qi_jiao_gong': mark(!!owner && [b.slots[0], b.slots[4]].includes(owner), power(15), '所属人物需要位于第 1 或第 5 格'); break;
      case 'zhen_jun_yi_dao': mark(!!owner && definition(owner).profession === 'warrior', '结算后自身本局永久威力 +10', '需要自动装备给武者');
        if (card.used.filter(marker => marker.startsWith('run:zhen_jun:')).length >= 3) { cue.state = 'used'; cue.message = '本局三次成长已用尽'; } break;
      case 'zhui_feng_diao_gong': mark(b.activeDiscards > 0, power(Math.min(45, b.activeDiscards * 15)), '需要本战主动弃牌'); break;
      case 'wu_xing_zhen_pan': mark(tactics.length > 0, amp(Math.min(3, tactics.length)), '需要战术共同出战'); break;
      case 'bing_ren_qi_ju': mark(weapons.length > 0, power(Math.min(30, weapons.length * 10)), '需要兵器共同出战'); break;
      case 'qi_xie_bing_yong': mark(new Set(weapons.map(weapon => definition(weapon).weaponClass)).size >= 2, amp(2), '需要两种不同分类的兵器'); break;
      case 'jun_shi_ru_hong': {
        const morale = b.morale + (b.moraleTier === 'none' ? 0 : characters.length);
        mark(morale > 0, power(Math.min(25, morale * 5)), '需要积累军势'); break;
      }
      case 'chou_cuo_jun_liang': mark(new Set(ids.map(other => definition(other).type)).size >= 3, `结算后获得 ${times} 金币`, '需要人物、兵器、战术共同出战'); break;
      case 'lei_gu_jin_jun': mark(characters.length > 0, power(Math.min(20, characters.length * 5)), '需要人物共同出战'); break;
      case 'ji_zhao_yuan_jun': {
        const available = b.draw.filter(other => definition(other).type === 'character').length;
        mark(available > 0, `结算后最多抽取 ${Math.min(times, available)} 张人物；满手入弃牌堆`, '抽牌堆中已无人物'); break;
      }
      case 'si_ji_er_dong': mark(b.activeDiscards > 0, amp(2), '需要本战主动弃牌'); break;
      case 'qing_zhuang_ji_xi': mark(ids.length === 2, power(25), '需要本次仅出两张牌'); break;
      case 'ben_zhi_xie_zhen': {
        const count = weapons.filter(weapon => equipment[weapon] && getWeaponMatch(definition(equipment[weapon]!), definition(weapon)) === 4).length;
        mark(count > 0, amp(Math.min(6, count * 2)), '需要至少一组实际本职装备'); break;
      }
      case 'xu_shi_xiang_sheng': {
        const count = tactics.filter(other => other !== id && definition(other).direction === 'power').length;
        mark(count > 0, amp(Math.min(4, count * 2)), '需要其他威力型战术共同出战'); break;
      }
      case 'duan_liang_qi_xi': mark(b.discardedTypes.length > 0, power(Math.min(45, b.discardedTypes.length * 15)), '需要主动弃牌积累类型'); break;
      case 'hou_jun_ya_zhen': {
        const count = b.hand.filter(other => definition(other).type === 'character').length;
        mark(count > 0, amp(Math.min(4, count)), '需要手牌中保留人物'); break;
      }
    }
    if (ONCE.has(d.skill) && b.used.includes(cue.id) && !(d.skill === 'lv_bu' && b.swallow.some(intent => intent.sourceId === id))) {
      cue.state = 'used'; cue.message = '本战已使用'; cue.choice = undefined;
    }
    if (d.skill && cue.name) result.push(cue);
    for (const skill of card.enhancementSkills) {
      const extra: SkillCue = { id: `${skill}:${id}`, sourceId: id, sourceName: d.name, name: ENHANCEMENTS[skill]!, state: 'waiting', message: '', targetIds: [] };
      const same = ids.filter(other => definition(other).type === d.type).length;
      if (skill === 'xian_deng' || skill === 'zhen_jun' || skill === 'hui_xiang') {
        extra.state = card.plays === 0 ? 'ready' : 'used';
        extra.message = card.plays > 0 ? '本战已使用' : skill === 'xian_deng' ? '本次威力 +25' : skill === 'zhen_jun' ? '本次增幅 +2' : '原技能额外结算一次';
      } else if (skill === 'jun_xu') {
        extra.state = b.used.includes(extra.id) ? 'used' : 'ready'; extra.message = extra.state === 'used' ? '本战已使用' : '结算后获得 1 金币';
      } else {
        extra.state = (skill === 'tong_dao' ? same > 1 : same === 1) ? 'ready' : 'waiting';
        extra.message = skill === 'tong_dao' ? extra.state === 'ready' ? '本次威力 +30' : '需要另一张同类型牌共同出战' : extra.state === 'ready' ? '本次增幅 +3' : '需要仅出一张该类型牌';
      }
      result.push(extra);
    }
  }
  return result.sort((a, b) => Number(b.state === 'choose') - Number(a.state === 'choose'));
}
