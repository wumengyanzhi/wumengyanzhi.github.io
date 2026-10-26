import { describe, expect, it } from 'vitest';
import { CARDS, CARD_MAP, DECKS, CHARMS, ENEMIES } from '../../v2/legacy/data';
import { startBattle, resolvePlay, previewBattle, getBattleChoices, discardCards, enhanceCard, canEcho } from '../../v2/battle';
import type { RunState } from '../../v2/model';
function setup(names: string[], characters = 18): RunState {
    const s = { version: 2, ruleset: 'mobile_v2', contentVersion: 'mobile_v2', seed: 'test', runId: 'battle-fixture', rng: { draw: 123, reward: 456, enhancement: 789, market: 234 }, revision: 0, receipts: [], deckId: 'test', difficulty: 'standard', leaderId: null, phase: 'camp', battleIndex: 0, cards: {}, owned: [], removed: [], charms: [null, null, null], gold: 0, battle: null, reward: null, enhancements: [], enhancementRerolls: 0, market: null, marketVisits: 0, removalsBought: 0, log: [], battles: [], nextId: 1, currentReports: [] } as RunState;
    for (const [i, name] of [...names, ...Array(Math.max(0, characters - names.filter(n => CARDS.find(c => c.name === n)?.type === 'character').length)).fill('蜀中弓手')].entries()) {
        const d = CARDS.find(c => c.name === name)!;
        const id = `c${i}`;
        s.owned.push(id);
        s.cards[id] = { id, definitionId: d.id, permanentPower: 0, permanentAmp: 0, temporaryPower: 0, temporaryAmp: 0, used: [], plays: 0, chain: false, enhancementSkills: [], growthRemainder: 0 };
    }
    startBattle(s);
    const b = s.battle!;
    b.slots = Array(5).fill(null);
    b.hand = s.owned.filter(id => Number(id.slice(1)) >= names.length).slice(0, 3);
    b.draw = s.owned.filter(id => !b.hand.includes(id) && Number(id.slice(1)) >= names.length);
    names.forEach((_, i) => b.slots[i] = `c${i}`);
    return s;
}
describe('V2 content and shared battle rules', () => {
    it('opens exactly the prescribed 60 cards and three 30-card starter decks', () => {
        expect(CARDS).toHaveLength(60);
        expect(CARDS.filter(c => c.type === 'character')).toHaveLength(30);
        expect(CARDS.filter(c => c.type === 'weapon')).toHaveLength(17);
        expect(CARDS.filter(c => c.type === 'tactic')).toHaveLength(13);
        expect(CHARMS).toHaveLength(9);
        expect(ENEMIES).toHaveLength(6);
        expect(DECKS).toHaveLength(3);
        expect(new Set(DECKS.flatMap(d => d.cards)).size).toBe(49);
        for (const d of DECKS) {
            expect(d.cards).toHaveLength(30);
            expect(d.cards.every(id => CARD_MAP[id])).toBe(true);
        }
    });
    it('automatically resolves the documented equipment example to 1320 and preserves preview purity', () => { const s = setup(['蜀中猛士', '环首刀', '魏营宿卫', '长柄铁枪', '擂鼓进军']); s.charms[0] = { id: 'ch', definitionId: 'three_kingdoms.charm.cui_bing_fu', acquiredPrice: 3 }; expect(getBattleChoices(s).some(c => c.key.startsWith('equip:'))).toBe(false); const before = JSON.stringify(s); expect(previewBattle(s).report?.damage).toBe(1320); expect(JSON.stringify(s)).toBe(before); const other = structuredClone(s); other.battle!.equipment.c1 = 'c2'; expect(resolvePlay(other).damage).toBe(1320); expect(resolvePlay(s).damage).toBe(1320); });
    it('executes lethal after-effects and gives a Pang Tong tactic back with chain for the next play', () => { const s = setup(['庞统', '筹措军粮', '环首刀']); s.battle!.targets['skill:c0'] = 'c1'; s.battle!.hp = 1; s.battle!.playsLeft = 1; resolvePlay(s); expect(s.gold).toBe(1); expect(s.phase).toBe('battle'); expect(s.battle!.hp).toBe(0); expect(s.battle!.hand).toContain('c1'); expect(s.cards.c1!.chain).toBe(true); });
    it('Guan Yu retains growth remainder and all Cao Cao copies listen once to other Wei enhancements', () => { const s = setup(['关羽', '曹操', '曹操', '魏武智士']); enhanceCard(s, 'c0', 30, 0); expect(s.cards.c0!.permanentAmp).toBe(1); enhanceCard(s, 'c0', 10, 0); expect(s.cards.c0!.permanentAmp).toBe(2); enhanceCard(s, 'c3', 20, 0); expect(s.cards.c1!.permanentPower).toBe(10); expect(s.cards.c2!.permanentPower).toBe(10); enhanceCard(s, 'c1', 20, 0); expect(s.cards.c2!.permanentPower).toBe(10); });
    it('counts only active hand discards and rejects staged cards atomically', () => { const s = setup(['孙尚香']); const before = JSON.stringify(s); expect(() => discardCards(s, ['c0'])).toThrow(); expect(JSON.stringify(s)).toBe(before); discardCards(s, [s.battle!.hand[0]!]); expect(s.battle!.activeDiscards).toBe(1); expect(s.battle!.discardsLeft).toBe(2); });
});
function chooseAll(s: RunState): void {
    for (let pass = 0; pass < 3; pass++)
        for (const c of getBattleChoices(s)) {
            if (c.key.startsWith('equip:'))
                s.battle!.equipment[c.key.slice(6)] = c.options[0]!.id;
            else if (!c.optional)
                s.battle!.targets[c.key] = c.options[0]!.id;
        }
}
describe('V2 boundary decisions and complete effect families', () => {
    it('copies an emergency draw skill twice, discarding an overflowed eighth-hand draw', () => {
        const s = setup(['急召援军']);
        const b = s.battle!;
        b.hand = s.owned.slice(1, 8);
        b.draw = s.owned.slice(8);
        b.hp = 1;
        s.cards.c0!.chain = true;
        const n = b.draw.length;
        resolvePlay(s);
        expect(b.hand).toHaveLength(8);
        expect(b.draw).toHaveLength(n - 2);
        expect(b.discard.filter(id => CARD_MAP[s.cards[id]!.definitionId]!.type === 'character')).toHaveLength(1);
    });
    it('does not shuffle when emergency reinforcements has no character in the draw pile', () => {
        const s = setup(['急召援军', '环首刀', '长柄铁枪'], 0);
        const b = s.battle!;
        b.slots = ['c0', null, null, null, null];
        b.draw = ['c1', 'c2'];
        b.hp = 1;
        const rng = s.rng.draw;
        resolvePlay(s);
        expect(s.rng.draw).toBe(rng);
        expect(b.draw).toEqual(['c1', 'c2']);
    });
    it('gives no basic value or extra morale when Pang Tong chain repeats a tactic', () => {
        const s = setup(['庞统', '筹措军粮', '环首刀']);
        const b = s.battle!;
        b.targets['skill:c0'] = 'c1';
        resolvePlay(s);
        expect(s.gold).toBe(1);
        expect(b.hand).toContain('c1');
        b.hand = b.hand.filter(x => x !== 'c1');
        b.discard = b.discard.filter(x => x !== 'c0' && x !== 'c2');
        b.slots = ['c0', 'c1', 'c2', null, null];
        const report = resolvePlay(s);
        expect(s.gold).toBe(3);
        expect(report.amp).toBe(6);
        expect(s.cards.c1!.chain).toBe(false);
        expect(b.morale).toBe(2);
    });
    it('allows echo on the first play then chain on the next, without copying base values', () => {
        const s = setup(['庞统', '擂鼓进军']);
        s.cards.c1!.enhancementSkills = ['hui_xiang'];
        s.battle!.targets['skill:c0'] = 'c1';
        const first = resolvePlay(s);
        expect(first.power).toBe(75);
        s.battle!.hand = s.battle!.hand.filter(x => x !== 'c1');
        s.battle!.discard = s.battle!.discard.filter(x => x !== 'c0');
        s.battle!.slots = ['c0', 'c1', null, null, null];
        const second = resolvePlay(s);
        expect(second.power).toBe(80);
        expect(s.cards.c1!.plays).toBe(2);
    });
    it('resolves Zhao Yun multipliers after the chosen weapons own skill and excludes matching bonuses', () => {
        const s = setup(['追风雕弓', '赵云', '并锋斩马刀'], 0);
        s.battle!.activeDiscards = 2;
        chooseAll(s);
        const r = resolvePlay(s);
        expect(r.power).toBe(165);
        expect(r.amp).toBe(12);
        expect(s.battle!.used).toContain('skill:c1');
    });
    it('Sun Shang Xiang discards a hand weapon without counting as an active discard', () => {
        const s = setup(['孙尚香', '环首刀'], 0);
        s.battle!.slots = ['c0', null, null, null, null];
        s.battle!.hand = ['c1'];
        s.battle!.targets['skill:c0'] = 'c1';
        s.battle!.hp = 1;
        expect(resolvePlay(s).power).toBe(50);
        expect(s.battle!.activeDiscards).toBe(0);
        expect(s.battle!.discardsLeft).toBe(3);
        expect(s.battle!.discard).toContain('c1');
    });
    it('locks morale tier for a battle, then recalculates it on the next battle', () => {
        const s = setup(['蜀中猛士'], 16);
        expect(s.battle!.moraleTier).toBe('array');
        s.removed.push('c15');
        expect(s.battle!.moraleTier).toBe('array');
        s.battleIndex = 1;
        startBattle(s);
        expect(s.battle!.moraleTier).toBe('formed');
    });
    it('swallows a leader only on victory and never returns the removed entity next battle', () => {
        const s = setup(['吕布', '魏武智士']);
        s.leaderId = 'c1';
        s.battle!.hp = 1;
        resolvePlay(s);
        expect(s.removed).toContain('c1');
        expect(s.leaderId).toBeNull();
        expect(s.cards.c0!.permanentPower).toBe(30);
        s.battleIndex = 1;
        startBattle(s);
        expect([...s.battle!.hand, ...s.battle!.draw]).not.toContain('c1');
        const lost = setup(['吕布', '魏武智士']);
        lost.battle!.playsLeft = 1;
        resolvePlay(lost);
        expect(lost.phase).toBe('lost');
        expect(lost.removed).toHaveLength(0);
        expect(lost.cards.c0!.permanentPower).toBe(0);
    });
    it('limits Zhen Jun Yi Dao to once per battle and three times per run', () => {
        const s = setup(['蜀中猛士', '镇军仪刀']);
        for (let i = 0; i < 4; i++) {
            if (i) {
                s.battleIndex = i;
                startBattle(s);
                s.battle!.hand = s.battle!.hand.filter(x => x !== 'c0' && x !== 'c1');
                s.battle!.draw = s.battle!.draw.filter(x => x !== 'c0' && x !== 'c1');
                s.battle!.slots = ['c0', 'c1', null, null, null];
            }
            s.battle!.hp = 1;
            resolvePlay(s);
        }
        expect(s.cards.c1!.permanentPower).toBe(30);
    });
    it('resolves enemy amp penalties before ordered charms and reports every source exactly', () => {
        const s = setup(['蜀中猛士', '环首刀'], 0);
        s.battle!.enemyId = ENEMIES[2]!.id;
        s.battle!.moraleTier = 'array';
        s.battle!.morale = 4;
        s.charms = [{ id: 'a', definitionId: 'three_kingdoms.charm.ju_shi_qi', acquiredPrice: 4 }, { id: 'b', definitionId: 'three_kingdoms.charm.cheng_shi_jing', acquiredPrice: 8 }, null];
        const other = structuredClone(s);
        other.charms.reverse();
        const r = resolvePlay(s);
        expect(r.amp).toBe(16);
        expect(resolvePlay(other).amp).toBe(13);
        expect(r.sources.reduce((v, x) => v + x.power, 0)).toBe(r.power);
        expect(1 + r.sources.reduce((v, x) => v + x.amp, 0)).toBe(r.amp);
    });
    it('refreshes only temporary stats and lets Zhou Yu count the locked remaining Wu hand', () => {
        const s = setup(['周瑜', '江东弓手', '江东策士']);
        s.battle!.slots = ['c0', null, null, null, null];
        s.battle!.hand = ['c1', 'c2'];
        s.battle!.hp = 1;
        expect(resolvePlay(s).power).toBe(105);
        expect(s.cards.c0!.temporaryPower).toBe(40);
        s.battleIndex = 1;
        startBattle(s);
        expect(s.cards.c0!.temporaryPower).toBe(0);
    });
    it.each([
        [['蜀中骁将', '环首刀'], 55, 6], [['巴蜀神射', '猎弓'], 55, 6], [['蜀汉密使'], 45, 1],
        [['魏武智士', '竹骨羽扇'], 55, 6], [['蜀中猛士', '虎卫宿将', '蜀中弓手'], 85, 1],
        [['江东神射', '蜀中猛士'], 65, 1], [['江东智将', '擂鼓进军'], 70, 1],
        [['江东铁卫', '长柄铁枪'], 55, 6], [['西凉骁将', '蜀中猛士'], 65, 1], [['乱世间客', '袖箭'], 55, 6],
        [['蜀中猛士', '百炼环首刀'], 45, 7], [['魏营宿卫', '羽林长枪'], 45, 7], [['魏营策士', '军师羽扇'], 45, 7],
        [['蜀中弓手', '雕翎强弓'], 45, 7], [['群雄间客', '燕尾袖镖'], 45, 7], [['蜀中弓手', '游骑角弓'], 50, 7],
        [['朱砂符笔', '擂鼓进军'], 35, 4], [['蜀中猛士', '连珠飞石', '蜀中弓手'], 55, 6],
        [['五行阵盘', '擂鼓进军', '筹措军粮'], 45, 10], [['兵刃齐举', '环首刀', '猎弓'], 60, 3],
        [['器械并用', '环首刀', '猎弓'], 20, 9], [['蜀中猛士', '擂鼓进军'], 45, 1],
        [['蜀中猛士', '左右策应', '蜀中弓手'], 40, 7], [['轻装疾袭', '蜀中猛士'], 65, 1],
        [['蜀中猛士', '环首刀', '本职协阵'], 30, 13], [['虚实相生', '擂鼓进军', '兵刃齐举'], 40, 10],
    ] as [
        string[],
        number,
        number
    ][])('executes exact card values and conditional skill for %j', (names, power, amp) => {
        const s = setup(names, 0);
        chooseAll(s);
        const r = resolvePlay(s);
        expect(r.power).toBe(power);
        expect(r.amp).toBe(amp);
    });
});
describe('V2 remaining content conditions', () => {
    it('has exact rarity and per-deck composition and immutable card definitions', () => {
        expect(['common', 'rare', 'epic', 'legendary'].map(r => CARDS.filter(c => c.rarity === r).length)).toEqual([13, 30, 13, 4]);
        for (const deck of DECKS) {
            expect(new Set(deck.cards).size).toBe(30);
            expect(['character', 'weapon', 'tactic'].map(type => deck.cards.filter(id => CARD_MAP[id]!.type === type).length)).toEqual([18, 8, 4]);
            expect(['common', 'rare', 'epic', 'legendary'].map(r => deck.cards.filter(id => CARD_MAP[id]!.rarity === r).length)).toEqual([13, 15, 2, 0]);
        }
        const before = JSON.stringify(CARDS);
        const s = setup(['关羽']);
        enhanceCard(s, 'c0', 30, 0);
        resolvePlay(s);
        expect(JSON.stringify(CARDS)).toBe(before);
    });
    it('uses one global morale count, adds current participants before skills, and grants none below11 characters', () => {
        const s = setup(['蜀中猛士', '军势如虹']);
        expect(resolvePlay(s).power).toBe(50);
        expect(s.battle!.morale).toBe(1);
        const none = setup(['蜀中猛士', '军势如虹'], 10);
        expect(resolvePlay(none).power).toBe(40);
        expect(none.battle!.morale).toBe(0);
    });
    it('recognizes remaining-hand tactics and characters independently from staged cards', () => {
        const s = setup(['魏营秘探', '后军压阵', '擂鼓进军'], 0);
        s.battle!.slots = ['c0', 'c1', null, null, null];
        s.battle!.hand = ['c2'];
        expect(resolvePlay(s).power).toBe(45);
        const other = setup(['后军压阵', '蜀中猛士', '蜀中弓手'], 0);
        other.battle!.slots = ['c0', null, null, null, null];
        other.battle!.hand = ['c1', 'c2'];
        expect(resolvePlay(other).amp).toBe(8);
    });
    it('active discards unlock the discard route and discarded types produce distinct bonuses', () => {
        const s = setup(['黄忠', '塞外神射', '伺机而动', '断粮奇袭'], 0);
        s.battle!.activeDiscards = 1;
        s.battle!.discardedTypes = ['character', 'weapon', 'tactic'];
        const r = resolvePlay(s);
        expect(r.power).toBe(185);
        expect(r.amp).toBe(7);
    });
    it('only grows Xia Hou Dun weapons and Zhu Ge Liang after damage and once per battle', () => {
        const s = setup(['夏侯惇', '环首刀'], 0);
        s.battle!.targets['skill:c0'] = 'c1';
        s.battle!.hp = 10000;
        const r = resolvePlay(s);
        expect(r.power).toBe(50);
        expect(s.cards.c1!.permanentPower).toBe(10);
        const b = s.battle!;
        b.discard = [];
        b.hand = [];
        b.slots = ['c0', 'c1', null, null, null];
        resolvePlay(s);
        expect(s.cards.c1!.permanentPower).toBe(10);
        const z = setup(['诸葛亮', '擂鼓进军', '军势如虹'], 0);
        expect(resolvePlay(z).power).toBe(85);
        expect(z.cards.c0!.permanentPower).toBe(15);
    });
    it('all additional enhancement skills use entity first-play counters and do not copy themselves', () => {
        const s = setup(['蜀中猛士', '蜀中弓手', '擂鼓进军'], 0);
        s.cards.c0!.enhancementSkills = ['xian_deng', 'zhen_jun', 'tong_dao', 'jun_xu'];
        s.cards.c2!.enhancementSkills = ['gu_feng'];
        const first = resolvePlay(s);
        expect(first.power).toBe(125);
        expect(first.amp).toBe(6);
        expect(s.gold).toBe(1);
        s.battle!.discard = [];
        s.battle!.hand = [];
        s.battle!.slots = ['c0', 'c1', 'c2', null, null];
        const second = resolvePlay(s);
        expect(second.power).toBe(100);
        expect(second.amp).toBe(4);
        expect(s.gold).toBe(1);
    });
    it('all statically listed charms have exact conditions and untriggered breakdown rows', () => {
        const s = setup(['蜀中猛士', '环首刀', '长柄铁枪', '擂鼓进军', '筹措军粮']);
        s.battle!.equipment.c1 = 'c0';
        s.battle!.equipment.c2 = 'c0'; // only c1 is adjacent: one pair cannot satisfy dual wield
        s.charms = [{ id: 'a', definitionId: 'three_kingdoms.charm.shuang_feng_jun_yin', acquiredPrice: 4 }, { id: 'b', definitionId: 'three_kingdoms.charm.lian_ce_jian', acquiredPrice: 3 }, { id: 'c', definitionId: 'three_kingdoms.charm.zhou_liu_chou', acquiredPrice: 4 }];
        const r = resolvePlay(s);
        expect(r.sources.filter(x => x.kind === 'charm').map(x => [x.power, x.amp])).toEqual([[0, 0], [0, 2], [40, 0]]);
        const dual = setup(['环首刀', '蜀中猛士', '长柄铁枪'], 0);
        dual.charms = [{ id: 'a', definitionId: 'three_kingdoms.charm.shuang_feng_jun_yin', acquiredPrice: 4 }, null, null];
        expect(resolvePlay(dual).amp).toBe(12);
        const ambush = setup(['蜀中弓手'], 0);
        ambush.battle!.activeDiscards = 2;
        ambush.charms = [{ id: 'a', definitionId: 'three_kingdoms.charm.fu_ji_ling', acquiredPrice: 3 }, { id: 'b', definitionId: 'three_kingdoms.charm.zhe_jian_ling', acquiredPrice: 4 }, { id: 'c', definitionId: 'three_kingdoms.charm.wen_jun_gu', acquiredPrice: 3 }];
        const a = resolvePlay(ambush);
        expect(a.power).toBe(70);
        expect(a.amp).toBe(4);
    });
    it.each([
        [0, ['c0', null, null, null, null], 20, 1], [1, ['c0', null, null, null, 'c1'], 55, 1],
        [2, ['c0', null, null, null, null], 20, 1], [2, [null, null, 'c0', null, null], 20, 1],
        [3, ['c2', null, 'c0', null, null], 50, 2], [4, ['c0', null, 'c2', null, null], 10, 2],
        [4, ['c0', 'c2', null, null, null], 30, 6], [5, ['c0', 'c2', null, null, 'c1'], 50, 6],
        [5, ['c0', 'c2', null, null, null], 30, 3],
    ] as [
        number,
        (string | null)[],
        number,
        number
    ][])('publishes enemy rule %i without hidden factors', (index, slots, power, amp) => {
        const s = setup(['蜀中猛士', '蜀中弓手', '环首刀'], 0);
        const b = s.battle!;
        b.slots = slots;
        b.hand = [];
        b.draw = [];
        b.enemyId = ENEMIES[index]!.id;
        chooseAll(s);
        const r = resolvePlay(s);
        expect(r.power).toBe(power);
        expect(r.amp).toBe(amp);
    });
    it('repeated previews do not consume draws, growth, coins, targets, or limited skills', () => {
        const s = setup(['庞统', '筹措军粮', '环首刀', '急召援军']);
        chooseAll(s);
        const before = JSON.stringify(s);
        for (let i = 0; i < 100; i++)
            expect(previewBattle(s).error).toBeNull();
        expect(JSON.stringify(s)).toBe(before);
        const a = structuredClone(s), b = structuredClone(s);
        expect(resolvePlay(a)).toEqual(resolvePlay(b));
        expect(a).toEqual(b);
    });
});
it('elite difficulty increases enemy health by15% with no hidden damage or reward factors', () => {
    const standard = setup(['蜀中猛士'], 0), elite = structuredClone(standard);
    elite.difficulty = 'elite';
    startBattle(elite);
    expect(elite.battle!.hp).toBe(2070);
    expect(elite.battle!.maxHp).toBe(2070);
    elite.battle!.hand = [];
    elite.battle!.draw = [];
    elite.battle!.slots = ['c0', null, null, null, null];
    expect(resolvePlay(elite).damage).toBe(resolvePlay(standard).damage);
});
describe('review regressions: duplicate skills and safe echo eligibility', () => {
    it('rejects two Sun Shang Xiang copies consuming the same weapon before any mutation', () => {
        const s = setup(['孙尚香', '孙尚香', '环首刀', '蜀中猛士'], 0), b = s.battle!;
        b.slots = ['c0', 'c1', null, null, null];
        b.hand = ['c2', 'c3'];
        b.targets = { 'skill:c0': 'c2', 'skill:c1': 'c2' };
        const before = JSON.stringify(s);
        expect(() => resolvePlay(s)).toThrow('同一件手牌武器');
        expect(JSON.stringify(s)).toBe(before);
        expect(previewBattle(s).report).toBeNull();
        expect(JSON.stringify(s)).toBe(before);
    });
    it('reserves each selected hand weapon for one Sun Shang Xiang and keeps skip available', () => {
        const s = setup(['孙尚香', '孙尚香', '环首刀', '长柄铁枪', '蜀中猛士'], 0), b = s.battle!;
        b.slots = ['c0', 'c1', null, null, null];
        b.hand = ['c2', 'c3', 'c4'];
        b.targets = { 'skill:c0': 'c2' };
        expect(getBattleChoices(s).find(c => c.key === 'skill:c1')?.options.map(o => o.id)).toEqual(['c3']);
        b.targets['skill:c1'] = 'c3';
        b.hp = 1;
        resolvePlay(s);
        expect(b.hand).toEqual(['c4']);
        expect(b.discard.filter(id => id === 'c2')).toHaveLength(1);
        expect(b.discard.filter(id => id === 'c3')).toHaveLength(1);
        const one = setup(['孙尚香', '孙尚香', '环首刀'], 0);
        one.battle!.slots = ['c0', 'c1', null, null, null];
        one.battle!.hand = ['c2'];
        one.battle!.targets['skill:c0'] = 'c2';
        const choice = getBattleChoices(one).find(c => c.key === 'skill:c1');
        expect(choice?.options).toEqual([]);
        expect(choice?.optional).toBe(true);
    });
    it.each(['百炼环首刀', '羽林长枪', '军师羽扇', '雕翎强弓', '燕尾袖镖'])('%s may not echo a skill that buffs another entity', (name) => {
        const d = CARDS.find(c => c.name === name)!;
        expect(canEcho(d)).toBe(false);
        const s = setup([name], 0);
        expect(() => enhanceCard(s, 'c0', 'power', 30, 'hui_xiang')).toThrow('附加技能不合法');
        expect(s.cards.c0!.permanentPower).toBe(0);
    });
    it('two Pang Tong copies may target one tactic but return that entity once and create only one next-play chain', () => {
        const s = setup(['庞统', '庞统', '擂鼓进军'], 0), b = s.battle!;
        b.targets = { 'skill:c0': 'c2', 'skill:c1': 'c2' };
        b.hp = 10000;
        resolvePlay(s);
        expect(b.hand.filter(id => id === 'c2')).toHaveLength(1);
        expect(b.used).toEqual(expect.arrayContaining(['skill:c0', 'skill:c1']));
        b.hand = b.hand.filter(id => id !== 'c2');
        b.draw = [];
        b.discard = [];
        b.slots = ['c0', 'c1', 'c2', null, null];
        b.hp = 1;
        const r = resolvePlay(s);
        expect(r.power).toBe(120);
        expect(s.cards.c2!.chain).toBe(false);
        expect(b.discard.filter(id => id === 'c2')).toHaveLength(1);
    });
});
