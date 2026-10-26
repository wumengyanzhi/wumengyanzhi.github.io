import { CARD_MAP, CHARM_MAP, ENEMIES, MATCH_MATRIX } from './data';
import { cloneRun, RuleError } from './model';
import type { RunState, BattleState, CardDef, BattleChoice, BattlePreview, BattleReport, Breakdown, EnhancementSkill } from './model';
import { random, shuffle } from './rng';
import * as legacy from './legacy/battle';
import { charmTier, charmValues, isCampaign } from './campaign';
const def = (s: RunState, id: string): CardDef => {
    const c = s.cards[id];
    const d = c && CARD_MAP[c.definitionId];
    if (!d)
        throw new RuleError('卡牌不存在');
    return d;
};
const active = (s: RunState): string[] => s.owned.filter(id => !s.removed.includes(id));
const battle = (s: RunState): BattleState => {
    if (s.phase !== 'battle' || !s.battle || s.battle.hp <= 0)
        throw new RuleError('当前不在可操作的战斗中');
    return s.battle;
};
export const getWeaponMatch = (c: CardDef, w: CardDef): number => c.type === 'character' && w.type === 'weapon' && c.profession && w.weaponClass ? MATCH_MATRIX[c.profession][w.weaponClass] : 0;
const used = (b: BattleState, id: string): boolean => b.used.includes(`skill:${id}`);
const mark = (b: BattleState, id: string): void => { b.used.push(`skill:${id}`); };
const key = (id: string): string => `skill:${id}`;
const income = (s: RunState, n: number, text: string): void => { s.gold += n; s.log.push({ id: `log-${s.nextId++}`, kind: 'income', text, goldDelta: n, battleIndex: s.battleIndex }); };
/** Eligibility mirrors V2's safe repeat whitelist; no movement, growth, choices or once-only skills. */
export function canEcho(d: CardDef): boolean {
    return new Set(['shu_zhong_xiao_jiang', 'ba_shu_shen_she', 'shu_han_mi_shi', 'wei_wu_zhi_shi', 'hu_wei_su_jiang', 'wei_ying_mi_tan', 'jiang_dong_shen_she', 'jiang_dong_zhi_jiang', 'jiang_dong_tie_wei', 'xi_liang_xiao_jiang', 'luan_shi_jian_ke', 'sai_wai_shen_she', 'bing_feng_zhan_ma_dao', 'zhu_sha_fu_bi', 'lian_zhu_fei_shi', 'you_qi_jiao_gong', 'zhui_feng_diao_gong', 'wu_xing_zhen_pan', 'bing_ren_qi_ju', 'qi_xie_bing_yong', 'jun_shi_ru_hong', 'lei_gu_jin_jun', 'zuo_you_ce_ying', 'si_ji_er_dong', 'qing_zhuang_ji_xi', 'ben_zhi_xie_zhen', 'xu_shi_xiang_sheng', 'duan_liang_qi_xi', 'hou_jun_ya_zhen']).has(d.skill);
}
export function enhanceCard(s: RunState, id: string, powerOrStat: number | 'power' | 'amp', ampOrAmount: number, skill?: EnhancementSkill | null): void {
    const c = s.cards[id];
    if (!c || !active(s).includes(id))
        throw new RuleError('强化目标不在有效牌组');
    const p = typeof powerOrStat === 'number' ? powerOrStat : powerOrStat === 'power' ? ampOrAmount : 0;
    const a = typeof powerOrStat === 'number' ? ampOrAmount : powerOrStat === 'amp' ? ampOrAmount : 0;
    if (p < 0 || a < 0 || !Number.isInteger(p) || !Number.isInteger(a))
        throw new RuleError('强化数值无效');
    if (skill && (c.enhancementSkills.includes(skill) || (skill === 'hui_xiang' && !canEcho(def(s, id)))))
        throw new RuleError('附加技能不合法');
    c.permanentPower += p;
    c.permanentAmp += a;
    if (skill)
        c.enhancementSkills.push(skill);
    if (def(s, id).skill === 'guan_yu' && p > 0) {
        c.growthRemainder += p;
        c.permanentAmp += Math.floor(c.growthRemainder / 20);
        c.growthRemainder %= 20;
    }
    if ((p || a || skill) && def(s, id).faction === 'wei' && def(s, id).skill !== 'cao_cao')
        for (const other of active(s))
            if (def(s, other).skill === 'cao_cao')
                s.cards[other]!.permanentPower += 10;
}
function draw(s: RunState, count: number): void {
    const b = s.battle!;
    while (count > 0 && b.hand.length < 8) {
        if (!b.draw.length) {
            if (!b.discard.length)
                break;
            b.draw = shuffle(s, 'draw', b.discard);
            b.discard = [];
        }
        const id = b.draw.shift()!;
        b.hand.push(id);
        count--;
    }
}
export function startBattle(s: RunState): void {
    if (!isCampaign(s)) return legacy.startBattle(s);
    const enemy = ENEMIES[s.battleIndex];
    if (!enemy)
        throw new RuleError('战次无效');
    const ids = active(s);
    for (const id of ids) {
        const c = s.cards[id]!;
        c.temporaryPower = 0;
        c.temporaryAmp = 0;
        c.plays = 0;
        c.chain = false;
    }
    const n = ids.filter(id => def(s, id).type === 'character').length;
    const leader = s.leaderId && ids.includes(s.leaderId) && def(s, s.leaderId).type === 'character' ? s.leaderId : null;
    const hp = Math.ceil(enemy.hp * (s.difficulty === 'elite' ? 1.15 : 1));
    s.battle = { enemyId: enemy.id, hp, maxHp: hp, playsLeft: 4, discardsLeft: 3, hand: leader ? [leader] : [], draw: shuffle(s, 'draw', ids.filter(id => id !== leader)), discard: [], slots: Array<string | null>(5).fill(null), equipment: {}, targets: {}, morale: 0, moraleTier: n >= 16 ? 'array' : n >= 11 ? 'formed' : 'none', activeDiscards: 0, discardedTypes: [], completedPlays: 0, used: [], swallow: [] };
    s.phase = 'battle';
    s.currentReports = [];
    draw(s, 8);
}
function neighbors(b: BattleState, id: string): string[] { const i = b.slots.indexOf(id); return [b.slots[i - 1], b.slots[i + 1]].filter((v): v is string => !!v); }
/** Derived from current neighboring slots only; legacy manual intent never overrides it. */
export function getEquipment(s: RunState): Record<string, string> {
    const eq: Record<string, string> = {};
    if (s.phase !== 'battle' || !s.battle || s.battle.hp <= 0)
        return eq;
    const b = s.battle;
    for (const id of b.slots) {
        if (!id || def(s, id).type !== 'weapon')
            continue;
        const opts = neighbors(b, id).filter(x => def(s, x).type === 'character');
        for (const target of opts)
            if (!eq[id] || getWeaponMatch(def(s, target), def(s, id)) > getWeaponMatch(def(s, eq[id]!), def(s, id)))
                eq[id] = target;
    }
    return eq;
}
/** Only weapon skills are exposed here; optional consumable targets remain manual. */
export function getAutomaticSkillTargets(s: RunState): Record<string, string> {
    if (!isCampaign(s)) return legacy.getAutomaticSkillTargets(s);
    const targets: Record<string, string> = {};
    if (s.phase !== 'battle' || !s.battle || s.battle.hp <= 0)
        return targets;
    const b = s.battle, eq = getEquipment(s);
    for (const id of b.slots) {
        if (!id || used(b, id))
            continue;
        const d = def(s, id), weapons = Object.keys(eq).filter(w => eq[w] === id);
        if (d.skill === 'xia_hou_dun')
            for (const weapon of weapons)
                if (!targets[key(id)] || getWeaponMatch(d, def(s, weapon)) > getWeaponMatch(d, def(s, targets[key(id)]!)))
                    targets[key(id)] = weapon;
        if (d.skill === 'zhao_yun' && weapons.length === 2) {
            const left = weapons[0]!, right = weapons[1]!;
            const leftDamage = scorePlay(s, eq, { ...b.targets, ...targets, [key(id)]: left }).damage;
            const rightDamage = scorePlay(s, eq, { ...b.targets, ...targets, [key(id)]: right }).damage;
            targets[key(id)] = rightDamage > leftDamage ? right : left;
        }
    }
    return targets;
}
export function getBattleChoices(s: RunState): BattleChoice[] {
    if (!isCampaign(s)) return legacy.getBattleChoices(s);
    if (s.phase !== 'battle' || !s.battle || s.battle.hp <= 0)
        return [];
    const b = s.battle;
    const choices: BattleChoice[] = [];
    const add = (k: string, label: string, ids: string[], optional = false) => {
        if (ids.length || optional)
            choices.push({ key: k, label, options: ids.map(id => { const d = def(s, id), c = s.cards[id]!, position = b.slots.indexOf(id); return { id, label: `${d.name} · ${position >= 0 ? `第${position + 1}格` : `手牌${b.hand.indexOf(id) + 1}`} · 威${d.power + c.permanentPower + c.temporaryPower}/幅${d.amp + c.permanentAmp + c.temporaryAmp}` }; }), optional });
    };
    for (const id of b.slots) {
        if (!id || used(b, id))
            continue;
        const d = def(s, id);
        if (d.skill === 'pang_tong') {
            const tactics = b.slots.filter((x): x is string => !!x && def(s, x).type === 'tactic');
            if (tactics.length > 1)
                add(key(id), '连环奇谋：选择回手并施加连环的战术', tactics);
        }
        if (d.skill === 'sun_shang_xiang')
            add(key(id), '弓腰姬：弃一件手牌武器换取威力', b.hand.filter(x => def(s, x).type === 'weapon' && !b.slots.some(other => other && other !== id && !used(b, other) && def(s, other).skill === 'sun_shang_xiang' && b.targets[key(other)] === x)), true);
    }
    return choices;
}
export function previewBattle(s: RunState): BattlePreview {
    if (!isCampaign(s)) return legacy.previewBattle(s);
    const choices = getBattleChoices(s);
    try {
        return { report: resolvePlay(cloneRun(s)), choices, error: null };
    }
    catch (e) {
        return { report: null, choices, error: e instanceof Error ? e.message : '无法预览' };
    }
}
export function discardCards(s: RunState, ids: string[]): void {
    if (!isCampaign(s)) return legacy.discardCards(s, ids);
    const b = battle(s);
    if (b.discardsLeft <= 0)
        throw new RuleError('主动弃牌次数不足');
    if (ids.length < 1 || ids.length > 5 || new Set(ids).size !== ids.length || ids.some(id => !b.hand.includes(id)))
        throw new RuleError('选择 1 至 5 张未上阵的手牌');
    b.discardsLeft--;
    b.activeDiscards++;
    for (const id of ids) {
        b.hand.splice(b.hand.indexOf(id), 1);
        b.discard.push(id);
        const t = def(s, id).type;
        if (!b.discardedTypes.includes(t))
            b.discardedTypes.push(t);
    }
    draw(s, ids.length);
}
/** Pure shared damage calculation: no draws, resources, cards or limit markers are mutated. */
function scorePlay(s: RunState, eq: Record<string, string>, targets: Record<string, string>) {
    const b = s.battle!;
    const ids = b.slots.filter((x): x is string => !!x);
    const hand = [...b.hand];
    const chars = ids.filter(id => def(s, id).type === 'character');
    const weapons = ids.filter(id => def(s, id).type === 'weapon');
    const tactics = ids.filter(id => def(s, id).type === 'tactic');
    const types = new Set(ids.map(id => def(s, id).type));
    const tacticNames = new Set(tactics.map(id => def(s, id).name));
    const morale = b.morale + (b.moraleTier === 'none' ? 0 : chars.length);
    const temporaryGrowth: Record<string, number> = {};
    const sources: Breakdown[] = [];
    const notes: string[] = [];
    const own: Record<string, {
        power: number;
        amp: number;
    }> = {};
    const multipliers: Record<string, {
        power: number;
        amp: number;
    }> = {};
    for (const id of ids) {
        const c = s.cards[id]!;
        const d = def(s, id);
        own[id] = { power: d.power + c.permanentPower + c.temporaryPower, amp: d.amp + c.permanentAmp + c.temporaryAmp };
        multipliers[id] = { power: 1, amp: 1 };
    }
    const add = (label: string, power: number, amp = 0, kind: Breakdown['kind'] = 'skill') => {
        if (power || amp)
            sources.push({ label, power, amp, kind });
    };
    const self = (id: string, p: number, a = 0) => { own[id]!.power += p; own[id]!.amp += a; };
    const equipped = (id: string) => weapons.filter(w => eq[w] === id);
    const primary = (id: string) => equipped(id).some(w => getWeaponMatch(def(s, id), def(s, w)) === 4);
    const adjacentChars = (id: string) => neighbors(b, id).filter(x => def(s, x).type === 'character');
    const original = (id: string) => {
        const d = def(s, id), n = neighbors(b, id), target = eq[id];
        switch (d.skill) {
            case 'shu_zhong_xiao_jiang':
            case 'ba_shu_shen_she':
            case 'wei_wu_zhi_shi':
            case 'jiang_dong_tie_wei':
            case 'luan_shi_jian_ke':
                if (primary(id))
                    self(id, 15);
                break;
            case 'shu_han_mi_shi':
                if (b.slots[0] === id || b.slots[4] === id)
                    self(id, 10);
                break;
            case 'hu_wei_su_jiang':
                if (adjacentChars(id).length === 2)
                    self(id, 20);
                break;
            case 'wei_ying_mi_tan':
                if (hand.some(h => def(s, h).type === 'tactic'))
                    self(id, 15);
                break;
            case 'jiang_dong_shen_she':
                if (n.length === 1)
                    self(id, 15);
                break;
            case 'jiang_dong_zhi_jiang':
                if (tactics.length)
                    self(id, 15);
                break;
            case 'xi_liang_xiao_jiang':
                if (ids.length === 2)
                    self(id, 20);
                break;
            case 'sai_wai_shen_she':
                if (b.activeDiscards > 0)
                    self(id, 15);
                break;
            case 'huang_zhong':
                if (b.activeDiscards > 0 && !used(b, id)) {
                    self(id, 25);
                    notes.push('黄忠本次威力 +25');
                }
                break;
            case 'zhao_yun':
                if (equipped(id).length === 2 && !used(b, id)) {
                    const p = targets[key(id)]!;
                    const a = equipped(id).find(w => w !== p)!;
                    multipliers[p]!.power = 2;
                    multipliers[a]!.amp = 2;
                    notes.push(`赵云双锋破阵：${def(s, p).name}本次有效威力翻倍，${def(s, a).name}本次有效增幅翻倍`);
                }
                break;
            case 'sun_shang_xiang': {
                const w = targets[key(id)];
                if (w && !used(b, id)) {
                    add('弓腰姬', def(s, w).power + s.cards[w]!.permanentPower);
                    notes.push(`孙尚香弓腰姬：弃置${def(s, w).name}，本次威力 +${def(s, w).power + s.cards[w]!.permanentPower}`);
                }
                break;
            }
            case 'zhou_yu': {
                const p = hand.filter(h => def(s, h).type === 'character' && def(s, h).faction === 'wu').length * 20;
                temporaryGrowth[id] = (temporaryGrowth[id] ?? 0) + p;
                self(id, p);
                break;
            }
            case 'lv_bu': {
                const right = b.slots[b.slots.indexOf(id) + 1];
                if (right && def(s, right).type === 'character' && !used(b, id)) {
                    notes.push(`胜利时吞噬${def(s, right).name}，下战人物数将减少`);
                }
                break;
            }
            case 'bai_lian_huan_shou_dao':
            case 'yu_lin_chang_qiang':
            case 'jun_shi_yu_shan':
            case 'diao_ling_qiang_gong':
            case 'yan_wei_xiu_biao':
                if (target && getWeaponMatch(def(s, target), d) === 4)
                    self(target, 10);
                break;
            case 'bing_feng_zhan_ma_dao':
                if (target && equipped(target).length >= 2)
                    self(id, 0, 1);
                break;
            case 'zhu_sha_fu_bi':
                if (tactics.length)
                    self(id, 0, 1);
                break;
            case 'lian_zhu_fei_shi':
                if (adjacentChars(id).length === 2)
                    self(id, 0, 1);
                break;
            case 'you_qi_jiao_gong':
                if (target && (b.slots[0] === target || b.slots[4] === target))
                    self(id, 15);
                break;
            case 'zhui_feng_diao_gong':
                self(id, Math.min(45, b.activeDiscards * 15));
                break;
            case 'wu_xing_zhen_pan':
                self(id, 0, Math.min(3, tactics.length));
                break;
            case 'bing_ren_qi_ju':
                add('器械集结', Math.min(30, weapons.length * 10));
                break;
            case 'qi_xie_bing_yong':
                if (new Set(weapons.map(w => def(s, w).weaponClass)).size >= 2)
                    add('异兵协作', 0, 2);
                break;
            case 'jun_shi_ru_hong':
                add('乘势进军', Math.min(25, morale * 5));
                break;
            case 'lei_gu_jin_jun':
                add('人多势众', Math.min(20, chars.length * 5));
                break;
            case 'zuo_you_ce_ying':
                if (adjacentChars(id).length === 2)
                    add('双翼协防', 0, 2);
                break;
            case 'si_ji_er_dong':
                if (b.activeDiscards > 0)
                    add('弃牌蓄势', 0, 2);
                break;
            case 'qing_zhuang_ji_xi':
                if (ids.length === 2)
                    add('轻编突袭', 25);
                break;
            case 'ben_zhi_xie_zhen':
                add('人械合契', 0, Math.min(6, weapons.filter(w => eq[w] && getWeaponMatch(def(s, eq[w]!), def(s, w)) === 4).length * 2));
                break;
            case 'xu_shi_xiang_sheng':
                add('威力转势', 0, Math.min(4, tactics.filter(t => t !== id && def(s, t).direction === 'power').length * 2));
                break;
            case 'duan_liang_qi_xi':
                add('断供破军', Math.min(45, b.discardedTypes.length * 15));
                break;
            case 'hou_jun_ya_zhen':
                add('留将蓄势', 0, Math.min(4, hand.filter(h => def(s, h).type === 'character').length));
                break;
        }
    };
    const repeats: Record<string, number> = {};
    for (const id of ids) {
        const c = s.cards[id]!;
        repeats[id] = 1 + (c.chain ? 1 : 0) + (c.plays === 0 && c.enhancementSkills.includes('hui_xiang') && canEcho(def(s, id)) ? 1 : 0);
        if (repeats[id]! > 2)
            throw new RuleError('非法的重复技能状态');
        for (let n = 0; n < repeats[id]!; n++)
            original(id);
        for (const skill of c.enhancementSkills) {
            if (skill === 'xian_deng' && c.plays === 0)
                add('先登', 25);
            if (skill === 'zhen_jun' && c.plays === 0)
                add('振军', 0, 2);
            if (skill === 'tong_dao' && ids.some(x => x !== id && def(s, x).type === def(s, id).type))
                add('同道', 30);
            if (skill === 'gu_feng' && !ids.some(x => x !== id && def(s, x).type === def(s, id).type))
                add('孤锋', 0, 3);
        }
    }
    for (const id of ids) {
        const d = def(s, id), c = s.cards[id]!, value = own[id]!, m = multipliers[id]!;
        const baseP = d.power + c.permanentPower + c.temporaryPower + (temporaryGrowth[id] ?? 0), baseA = d.amp + c.permanentAmp + c.temporaryAmp;
        add(d.name, baseP, baseA, 'cards');
        add(`${d.name}技能`, value.power * m.power - baseP, value.amp * m.amp - baseA);
        if (eq[id])
            add(`${d.name} → ${def(s, eq[id]!).name}`, 0, getWeaponMatch(def(s, eq[id]!), d), 'equipment');
    }
    add('共享军势', b.moraleTier === 'none' ? 0 : morale * 5, b.moraleTier === 'array' ? Math.floor(morale / 5) : 0, 'morale');
    add('跨关基础增幅', 0, s.baseAmp ?? 0);
    let power = sources.reduce((v, x) => v + x.power, 0), amp = 1 + sources.reduce((v, x) => v + x.amp, 0);
    const enemy = ENEMIES.find(e => e.id === b.enemyId);
    // Keep exact rational values through Boss penalties and the ordered charm chain.
    let pn = BigInt(power), pd = 1n, an = BigInt(amp), ad = 1n;
    const edgeType = (i: number, type: string) => !!b.slots[i] && def(s, b.slots[i]!).type === type;
    switch (enemy?.rule) {
        case 'campaign_center':
            if (!edgeType(2, 'character')) an = BigInt(Math.max(1, amp - 3));
            break;
        case 'campaign_empty_second':
            if (b.slots[1]) {pn *= 3n; pd = 4n;}
            break;
        case 'campaign_wings':
            if (!edgeType(0, 'character') || !edgeType(4, 'character')) {an *= 3n;ad = 4n;if(an<ad)an=ad;}
            break;
    }
    const np = Number(pn)/Number(pd), na = Number(an)/Number(ad);
    add(enemy?.name ?? '敌阵', np - power, na - amp, 'enemy');
    power = np;
    amp = na;
    for (const ch of s.charms) {
        if (!ch)
            continue;
        const d = CHARM_MAP[ch.definitionId];
        if (!d)
            continue;
        const suffix = d.id.split('.').at(-1);
        let triggered = false;
        switch (suffix) {
            case 'cui_bing_fu':
                triggered = chars.some(primary);
                break;
            case 'shuang_feng_jun_yin':
                triggered = chars.some(c => equipped(c).length >= 2);
                break;
            case 'lian_ce_jian':
                triggered = tactics.length >= 2;
                break;
            case 'zhou_liu_chou':
                triggered = tacticNames.size >= 2;
                break;
            case 'fu_ji_ling':
                triggered = b.activeDiscards >= 1;
                break;
            case 'zhe_jian_ling':
                triggered = b.activeDiscards >= 2 && chars.some(c => def(s, c).profession === 'archer');
                break;
            case 'wen_jun_gu':
            case 'ju_shi_qi':
                triggered = true;
                break;
            case 'cheng_shi_jing':
                triggered = morale >= 5 && types.size >= 2;
                break;
        }
        const v = triggered ? charmValues(ch.definitionId, charmTier(ch)) : {power:0,amp:0,multiplier:[1,1] as const};
        const [mn,md] = v.multiplier, m = mn/md;
        pn += BigInt(v.power)*pd;
        an = an*BigInt(mn)+BigInt(v.amp)*ad*BigInt(md);ad *= BigInt(md);
        const nextAmp=Number(an)/Number(ad);
        sources.push({ label: `${d.name} · ${['Ⅰ','Ⅱ','Ⅲ'][charmTier(ch)-1]}阶${triggered?'':'（未触发）'}`, power:v.power,amp:Math.round((nextAmp-amp)*1e8)/1e8,kind:'charm',...(m>1?{multiplier:m}:{}) });
        amp=nextAmp;
    }
    power=Math.max(0,Number(pn/pd));amp=Math.max(1,Number(an/ad));
    const damage = power * amp;
    if(!Number.isSafeInteger(damage))throw new RuleError('本次伤害超出可精确结算范围');
    return { power, amp, damage, sources, notes, repeats };
}

export function resolvePlay(s: RunState): BattleReport {
    if (!isCampaign(s)) return legacy.resolvePlay(s);
    const b = battle(s);
    const ids = b.slots.filter((x): x is string => !!x);
    if (!ids.length || ids.length > 5 || new Set(ids).size !== ids.length || ids.some(id => !active(s).includes(id)))
        throw new RuleError('请摆出 1 至 5 张有效卡牌');
    if (b.playsLeft <= 0)
        throw new RuleError('出战次数不足');
    // Reserve consumable targets before spending any play, skill count or card.
    const reservedWeapons = new Set<string>();
    for (const id of ids) {
        if (def(s, id).skill !== 'sun_shang_xiang' || used(b, id))
            continue;
        const target = b.targets[key(id)];
        if (!target)
            continue;
        if (reservedWeapons.has(target))
            throw new RuleError('同一件手牌武器不能被重复弃置');
        if (!b.hand.includes(target) || def(s, target).type !== 'weapon')
            throw new RuleError('弓腰姬的目标必须是当前手牌武器');
        reservedWeapons.add(target);
    }
    const choices = getBattleChoices(s);
    for (const c of choices) {
        const target = b.targets[c.key];
        if (!target) {
            if (!c.optional)
                throw new RuleError(`需选择：${c.label}`);
        }
        else if (!c.options.some(o => o.id === target))
            throw new RuleError(`目标无效：${c.label}`);
    }
    const eq = getEquipment(s);
    const targets = getAutomaticSkillTargets(s);
    for (const choice of choices)
        if (b.targets[choice.key])
            targets[choice.key] = b.targets[choice.key]!;
    for (const id of ids)
        if (def(s, id).skill === 'pang_tong' && !used(b, id)) {
            const tactics = ids.filter(t => def(s, t).type === 'tactic');
            if (tactics.length === 1)
                targets[key(id)] = tactics[0]!;
        }
    const { power, amp, damage, sources, notes, repeats } = scorePlay(s, eq, targets);
    const chars = ids.filter(id => def(s, id).type === 'character');
    const tacticNames = new Set(ids.filter(id => def(s, id).type === 'tactic').map(id => def(s, id).name));
    const types = new Set(ids.map(id => def(s, id).type));
    b.playsLeft--;
    if (b.moraleTier !== 'none')
        b.morale += chars.length;
    for (const id of ids) {
        const d = def(s, id), c = s.cards[id]!;
        c.chain = false;
        if (d.skill === 'huang_zhong' && b.activeDiscards > 0 && !used(b, id))
            mark(b, id);
        if (d.skill === 'zhao_yun' && targets[key(id)] && !used(b, id))
            mark(b, id);
        if (d.skill === 'sun_shang_xiang' && targets[key(id)] && !used(b, id)) {
            const weapon = targets[key(id)]!;
            b.hand.splice(b.hand.indexOf(weapon), 1);
            b.discard.push(weapon);
            mark(b, id);
        }
        if (d.skill === 'zhou_yu') {
            const growth = b.hand.filter(h => def(s, h).type === 'character' && def(s, h).faction === 'wu').length * 20;
            c.temporaryPower += growth;
            if (growth) notes.push(`周瑜本场临时威力 +${growth}`);
        }
        if (d.skill === 'lv_bu' && !used(b, id)) {
            const right = b.slots[b.slots.indexOf(id) + 1];
            if (right && def(s, right).type === 'character') {
                b.swallow.push({ sourceId: id, targetId: right, power: def(s, right).power + s.cards[right]!.permanentPower });
                mark(b, id);
            }
        }
    }
    const actualDamage = Math.min(b.hp, damage);
    b.hp = Math.max(0, b.hp - damage);
    const returned: string[] = [];
    for (const id of ids) {
        const d = def(s, id), c = s.cards[id]!;
        for (let n = 0; n < repeats[id]!; n++)
            switch (d.skill) {
                case 'xia_hou_dun': {
                    const t = targets[key(id)];
                    if (t && !used(b, id)) {
                        enhanceCard(s, t, 10, 0);
                        mark(b, id);
                        notes.push(`${def(s, t).name}本局永久威力 +10`);
                    }
                    break;
                }
                case 'zhu_ge_liang':
                    if (tacticNames.size >= 2 && !used(b, id)) {
                        enhanceCard(s, id, 15, 0);
                        mark(b, id);
                        notes.push('诸葛亮本局永久威力 +15');
                    }
                    break;
                case 'pang_tong': {
                    const t = targets[key(id)];
                    if (t && !used(b, id) && !s.removed.includes(t)) {
                        s.cards[t]!.chain = true;
                        returned.push(t);
                        mark(b, id);
                    }
                    break;
                }
                case 'zhen_jun_yi_dao':
                    if (eq[id] && def(s, eq[id]!).profession === 'warrior' && !used(b, id) && c.used.filter(x => x.startsWith('run:zhen_jun:')).length < 3) {
                        enhanceCard(s, id, 10, 0);
                        c.used.push(`run:zhen_jun:${s.battleIndex}`);
                        mark(b, id);
                        notes.push(`${d.name}本局永久威力 +10`);
                    }
                    break;
                case 'chou_cuo_jun_liang':
                    if (types.size >= 3) {
                        income(s, 1, '筹措军粮 +1 金币');
                        notes.push('筹措军粮：金币 +1');
                    }
                    break;
                case 'ji_zhao_yuan_jun': {
                    const eligible = b.draw.filter(x => def(s, x).type === 'character');
                    if (eligible.length) {
                        const t = eligible[Math.floor(random(s, 'draw') * eligible.length)]!;
                        b.draw.splice(b.draw.indexOf(t), 1);
                        if (b.hand.length < 8) {
                            b.hand.push(t);
                            notes.push(`急召援军：${def(s, t).name}进入手牌`);
                        }
                        else {
                            b.discard.push(t);
                            notes.push(`急召援军：${def(s, t).name}，手牌已满，进入弃牌堆`);
                        }
                        b.draw = shuffle(s, 'draw', b.draw);
                    }
                    break;
                }
            }
        if (c.enhancementSkills.includes('jun_xu') && !b.used.includes(`jun_xu:${id}`)) {
            income(s, 1, '军需 +1 金币');
            notes.push(`${d.name} · 军需：金币 +1`);
            b.used.push(`jun_xu:${id}`);
        }
        c.plays++;
    }
    for (const id of ids) {
        if (s.removed.includes(id))
            continue;
        if (returned.includes(id)) {
            if (b.hand.length < 8) {
                b.hand.push(id);
                notes.push(`庞统连环奇谋：${def(s, id).name}回到手牌，下次出战获得连环`);
            }
            else {
                b.discard.push(id);
                notes.push(`庞统连环奇谋：${def(s, id).name}获得连环，手牌已满，留在弃牌区`);
            }
        }
        else
            b.discard.push(id);
    }
    b.slots = Array<string | null>(5).fill(null);
    b.equipment = {};
    b.targets = {};
    b.completedPlays++;
    const report: BattleReport = { power, amp, damage, actualDamage, overflow: Math.max(0, damage - actualDamage), sources, notes, playedIds: ids };
    s.currentReports.push(report);
    if (b.hp === 0) {
        for (const intent of b.swallow) {
            if (s.removed.includes(intent.targetId) || s.removed.includes(intent.sourceId))
                continue;
            s.removed.push(intent.targetId);
            for (const zone of [b.hand, b.draw, b.discard]) {
                const i = zone.indexOf(intent.targetId);
                if (i >= 0)
                    zone.splice(i, 1);
            }
            if (s.leaderId === intent.targetId)
                s.leaderId = null;
            enhanceCard(s, intent.sourceId, intent.power, 0);
            notes.push(`吕布吞噬${def(s, intent.targetId).name}，本局永久威力 +${intent.power}`);
        }
        b.swallow = [];
    }
    else if (b.playsLeft === 0)
        s.phase = 'lost';
    else {
        draw(s, 8 - b.hand.length);
        if (!b.hand.length)
            s.phase = 'lost';
    }
    notes.splice(100);
    return report;
}
