import { describe, expect, it } from 'vitest';
import { CARDS, CARD_MAP, DECKS } from '../../v2/data';
import { act, createRun, CONTENT_VERSION } from '../../v2/engine';
import { getAutomaticSkillTargets, getBattleChoices, getEquipment, getWeaponMatch, previewBattle, resolvePlay } from '../../v2/battle';
import { parseRun, serializeRun } from '../../v2/persistence';
import type { RunState } from '../../v2/model';

function setup(names: string[], slots = names.map((_, i) => i)): RunState {
  const s = createRun(DECKS[0]!.id, DECKS[0]!.leaders[0]!, 'automatic-equipment');
  const ids = s.owned.slice(0, names.length);
  names.forEach((name, i) => { s.cards[ids[i]!]!.definitionId = CARDS.find(d => d.name === name)!.id; });
  s.leaderId = s.owned.find(id => CARD_MAP[s.cards[id]!.definitionId]!.type === 'character')!;
  s.charms = [null, null, null];
  const b = s.battle!;
  b.slots = Array<string | null>(5).fill(null);
  slots.forEach((slot, i) => { b.slots[slot] = ids[i]!; });
  b.hand = [];
  b.draw = s.owned.filter(id => !ids.includes(id));
  b.moraleTier = 'none';
  return s;
}
const id = (s: RunState, index: number) => s.owned[index]!;
const skill = (s: RunState, index: number) => `skill:${id(s, index)}`;

describe('automatic equipment and weapon skills', () => {
  it('equips immediately by profession, ignores manual overrides, and exposes no equipment choice', () => {
    const s = setup(['蜀中弓手', '环首刀', '蜀中猛士']);
    s.battle!.equipment[id(s, 1)] = id(s, 0);
    expect(getEquipment(s)).toEqual({ [id(s, 1)]: id(s, 2) });
    expect(getBattleChoices(s)).toEqual([]);
    expect(previewBattle(s).error).toBeNull();
    expect(previewBattle(s).report!.sources.filter(x => x.kind === 'equipment').map(x => x.amp)).toEqual([4]);
    expect(getWeaponMatch(CARDS.find(d => d.name === '蜀中猛士')!, CARDS.find(d => d.name === '环首刀')!)).toBe(4);
  });

  it('breaks matching ties to the left and never crosses an empty slot', () => {
    const s = setup(['蜀中猛士', '环首刀', '蜀中猛士']);
    expect(getEquipment(s)).toEqual({ [id(s, 1)]: id(s, 0) });
    s.battle!.slots = [id(s, 0), null, id(s, 1), null, id(s, 2)];
    expect(getEquipment(s)).toEqual({});
    expect(previewBattle(s).report!.amp).toBe(2);
    s.phase = 'camp'; s.battle = null;
    expect(getEquipment(s)).toEqual({});
    expect(getAutomaticSkillTargets(s)).toEqual({});
  });

  it('recomputes ownership after an atomic formation move', () => {
    const s = setup(['蜀中弓手', '环首刀', '蜀中猛士']);
    const moved = act(s, { type: 'stage', cardId: id(s, 2), slot: 0 });
    expect(moved.ok).toBe(true);
    expect(getEquipment(moved.state)).toEqual({ [id(s, 1)]: id(s, 2) });
    expect(moved.state.battle!.slots).toEqual([id(s, 2), id(s, 1), id(s, 0), null, null]);
    const recalled = act(s, { type: 'unstage', slot: 2 });
    expect(recalled.ok).toBe(true);
    expect(getEquipment(recalled.state)).toEqual({ [id(s, 1)]: id(s, 0) });
  });

  it('automatically tempers the best matched equipped weapon, with left ties', () => {
    const s = setup(['长柄铁枪', '夏侯惇', '环首刀']);
    s.battle!.targets[skill(s, 1)] = id(s, 0);
    expect(getAutomaticSkillTargets(s)).toEqual({ [skill(s, 1)]: id(s, 2) });
    expect(getBattleChoices(s)).toEqual([]);
    const report = resolvePlay(s);
    expect(s.cards[id(s, 2)]!.permanentPower).toBe(10);
    expect(s.cards[id(s, 0)]!.permanentPower).toBe(0);
    expect(report.notes).toContain('环首刀本局永久威力 +10');
    const tie = setup(['环首刀', '夏侯惇', '环首刀']);
    expect(getAutomaticSkillTargets(tie)).toEqual({ [skill(tie, 1)]: id(tie, 0) });
    tie.battle!.used.push(skill(tie, 1));
    expect(getAutomaticSkillTargets(tie)).toEqual({});
  });

  it('ignores stale automatic skill targets when their equipment condition is no longer met', () => {
    const s = setup(['夏侯惇', '环首刀'], [0, 3]);
    s.battle!.targets[skill(s, 0)] = id(s, 1);
    expect(getAutomaticSkillTargets(s)).toEqual({});
    resolvePlay(s);
    expect(s.cards[id(s, 1)]!.permanentPower).toBe(0);
    expect(s.battle!.used).not.toContain(skill(s, 0));
    const z = setup(['赵云', '环首刀']);
    z.battle!.targets[skill(z, 0)] = id(z, 1);
    resolvePlay(z);
    expect(z.battle!.used).not.toContain(skill(z, 0));
  });

  it('assigns Zhao Yun multipliers by final damage including weapon skills and left ties', () => {
    const s = setup(['追风雕弓', '赵云', '并锋斩马刀']);
    s.battle!.activeDiscards = 2;
    s.battle!.targets[skill(s, 1)] = id(s, 2);
    expect(getAutomaticSkillTargets(s)).toEqual({ [skill(s, 1)]: id(s, 0) });
    const r = previewBattle(s).report!;
    expect([r.power, r.amp, r.damage]).toEqual([165, 12, 1980]);
    expect(r.notes).toContain('赵云双锋破阵：追风雕弓本次有效威力翻倍，并锋斩马刀本次有效增幅翻倍');
    const right = setup(['环首刀', '赵云', '长柄铁枪']);
    right.cards[id(right, 0)]!.permanentAmp = 20;
    expect(getAutomaticSkillTargets(right)).toEqual({ [skill(right, 1)]: id(right, 2) });
    expect(previewBattle(right).report!.damage).toBe(3500);
    const tie = setup(['环首刀', '赵云', '环首刀']);
    expect(getAutomaticSkillTargets(tie)).toEqual({ [skill(tie, 1)]: id(tie, 0) });
  });

  it('automatically returns a unique Pang Tong tactic and asks for multiple targets', () => {
    const one = setup(['庞统', '擂鼓进军']);
    expect(getBattleChoices(one)).toEqual([]);
    expect(getAutomaticSkillTargets(one)).toEqual({});
    const report = resolvePlay(one);
    expect(one.battle!.hand).toContain(id(one, 1));
    expect(one.cards[id(one, 1)]!.chain).toBe(true);
    expect(report.notes).toContain('庞统连环奇谋：擂鼓进军回到手牌，下次出战获得连环');
    const many = setup(['庞统', '擂鼓进军', '军势如虹']);
    expect(getBattleChoices(many).map(c => [c.key, c.options.map(o => o.id)])).toEqual([[skill(many, 0), [id(many, 1), id(many, 2)]]]);
    const before = JSON.stringify(many);
    expect(act(many, { type: 'play' }).ok).toBe(false);
    expect(JSON.stringify(many)).toBe(before);
  });

  it('does not claim Pang Tong returned a tactic when emergency draws filled the hand', () => {
    const s = setup(['庞统', '擂鼓进军', '急召援军', '急召援军', '急召援军']);
    s.battle!.hand = s.battle!.draw.splice(0, 5);
    s.battle!.targets[skill(s, 0)] = id(s, 1);
    s.battle!.hp = 1;
    const report = resolvePlay(s);
    expect(s.battle!.hand).toHaveLength(8);
    expect(s.battle!.hand).not.toContain(id(s, 1));
    expect(report.notes.some(note => note.includes('擂鼓进军回到手牌'))).toBe(false);
    expect(report.notes).toContain('庞统连环奇谋：擂鼓进军获得连环，手牌已满，留在弃牌区');
  });

  it('keeps Sun Shang Xiang consumption optional and records an actual chosen discard only', () => {
    const s = setup(['孙尚香', '环首刀']);
    s.battle!.slots[1] = null; s.battle!.hand = [id(s, 1)]; s.battle!.hp = 1;
    const skipped = structuredClone(s);
    expect(getBattleChoices(s)[0]!.optional).toBe(true);
    expect(resolvePlay(skipped).notes.some(n => n.includes('弓腰姬'))).toBe(false);
    expect(skipped.battle!.hand).toContain(id(s, 1));
    s.battle!.targets[skill(s, 0)] = id(s, 1);
    const r = resolvePlay(s);
    expect(r.notes).toContain('孙尚香弓腰姬：弃置环首刀，本次威力 +10');
    expect(s.battle!.discard).toContain(id(s, 1));
    expect(s.battle!.activeDiscards).toBe(0);
  });

  it('keeps repeated automatic targeting and previews pure with random draws and growth', () => {
    const s = setup(['环首刀', '赵云', '长柄铁枪', '急召援军', '筹措军粮']);
    const before = JSON.stringify(s);
    for (let i = 0; i < 20; i++) { getEquipment(s); getAutomaticSkillTargets(s); expect(previewBattle(s).error).toBeNull(); }
    expect(JSON.stringify(s)).toBe(before);
    const a = structuredClone(s), b = structuredClone(s);
    expect(resolvePlay(a)).toEqual(resolvePlay(b));
    expect(a).toEqual(b);
  });

  it('records limited growth and discard bonuses only when actually triggered', () => {
    const z = setup(['诸葛亮', '擂鼓进军', '军势如虹']);
    expect(resolvePlay(z).notes).toContain('诸葛亮本局永久威力 +15');
    const h = setup(['黄忠']);
    expect(previewBattle(h).report!.notes).toEqual([]);
    h.battle!.activeDiscards = 1;
    expect(resolvePlay(h).notes).toContain('黄忠本次威力 +25');
  });
});

describe('legacy automatic choices remain safely importable', () => {
  it('accepts and removes validated old equipment and temper targets without changing the source', () => {
    const s = setup(['蜀中猛士', '环首刀', '夏侯惇', '长柄铁枪']);
    s.battle!.equipment[id(s, 1)] = id(s, 2);
    s.battle!.targets[skill(s, 2)] = id(s, 1);
    const before = JSON.stringify(s);
    const parsed = parseRun(before);
    expect(parsed.contentVersion).toBe(CONTENT_VERSION);
    expect(parsed.battle!.equipment).toEqual({});
    expect(parsed.battle!.targets).toEqual({});
    expect(getAutomaticSkillTargets(parsed)).toEqual({ [skill(s, 2)]: id(s, 3) });
    expect(JSON.stringify(s)).toBe(before);
    expect(parseRun(serializeRun(parsed))).toEqual(parsed);
  });

  it('accepts an old valid Zhao Yun target and replaces it with the deterministic optimum', () => {
    const s = setup(['环首刀', '赵云', '长柄铁枪']);
    s.cards[id(s, 0)]!.permanentAmp = 20;
    s.battle!.targets[skill(s, 1)] = id(s, 0);
    const parsed = parseRun(JSON.stringify(s));
    expect(parsed.battle!.targets).toEqual({});
    expect(getAutomaticSkillTargets(parsed)[skill(s, 1)]).toBe(id(s, 2));
  });

  it('migrates a unique Pang Tong target while preserving a legitimate optional consumable choice', () => {
    const s = setup(['庞统', '擂鼓进军', '孙尚香', '环首刀']);
    s.battle!.slots[3] = null; s.battle!.hand = [id(s, 3)];
    s.battle!.targets = { [skill(s, 0)]: id(s, 1), [skill(s, 2)]: id(s, 3) };
    const parsed = parseRun(JSON.stringify(s));
    expect(parsed.battle!.targets).toEqual({ [skill(s, 2)]: id(s, 3) });
    expect(previewBattle(parsed).error).toBeNull();
  });

  it.each(['unknown-equipment', 'distant-equipment', 'unknown-skill', 'wrong-source', 'wrong-target', 'object-target', 'object-equipment', 'equipment-array', 'targets-array', 'used-target'])('rejects a forged old %s choice before discarding it', kind => {
    const s = setup(['环首刀', '夏侯惇', '长柄铁枪', '蜀中猛士']);
    if (kind === 'unknown-equipment') s.battle!.equipment.missing = id(s, 1);
    if (kind === 'distant-equipment') s.battle!.equipment[id(s, 0)] = id(s, 3);
    if (kind === 'unknown-skill') s.battle!.targets['skill:missing'] = id(s, 0);
    if (kind === 'wrong-source') s.battle!.targets[skill(s, 3)] = id(s, 0);
    if (kind === 'wrong-target') s.battle!.targets[skill(s, 1)] = id(s, 3);
    if (kind === 'object-target') (s.battle!.targets as Record<string, unknown>)[skill(s, 1)] = {};
    if (kind === 'object-equipment') (s.battle!.equipment as Record<string, unknown>)[id(s, 0)] = {};
    if (kind === 'equipment-array') (s.battle as unknown as Record<string, unknown>).equipment = [];
    if (kind === 'targets-array') (s.battle as unknown as Record<string, unknown>).targets = [];
    if (kind === 'used-target') { s.battle!.targets[skill(s, 1)] = id(s, 0); s.battle!.used.push(skill(s, 1)); }
    expect(() => parseRun(JSON.stringify(s))).toThrow('存档无效');
  });

  it('explains a legacy equip command without permitting a manual ownership override', () => {
    const s = setup(['蜀中弓手', '环首刀', '蜀中猛士']);
    const result = act(s, { type: 'equip', weaponId: id(s, 1), targetId: id(s, 0) });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('自动');
    expect(result.state).toBe(s);
    const automatic = act(s, { type: 'equip', weaponId: id(s, 1), targetId: id(s, 2) });
    expect(automatic.ok).toBe(true);
    expect(automatic.state.battle!.equipment).toEqual({});
  });
});
