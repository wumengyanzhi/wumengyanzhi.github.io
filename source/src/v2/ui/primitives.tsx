import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import type { CardDef, CardInstance, CardType, GameAction, RunState } from '../model';
import { CARD_MAP } from '../data';
import { CardArt, CharmArt } from './card-art';
import { charmDefinition, charmTier, isCampaign } from '../campaign';
import { AUTOMATIC_EQUIPMENT_TEXT, getCardRuleText, getCardSkillName } from './card-copy';
import './card-presentation.css';

export const TYPES = { character: '人物', weapon: '兵器', tactic: '战术' };
export const RARITIES = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
export const FACTIONS = { shu: '蜀', wei: '魏', wu: '吴', qun: '群' };
export const PROFESSIONS = { warrior: '武者', archer: '射手', mage: '术士', assassin: '暗客', guardian: '卫士' };
export const WEAPONS = { blade: '刀剑', spear: '长兵', bow: '弓弩', focus: '法器', hidden: '暗器' };
const RARITY_LEVEL = { common: 1, rare: 2, epic: 3, legendary: 4 };
export function CardTypeIcon({ type }: { type: CardType }) {
  return <svg className="v2-card-type-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{type === 'character' ? <><path d="M8 9V7a4 4 0 0 1 8 0v2M7 9h10l-1 5-4 3-4-3zM9 16l-5 4v1h16v-1l-5-4" /><path d="M12 4v5" /></> : type === 'weapon' ? <><path d="m4 3 13 13m-1-4 4 4-4 4-4-4m4 3 3 3M20 3 7 16m1-4-4 4 4 4 4-4m-4 3-3 3" /></> : <><path d="M6 4h13a2 2 0 0 1 2 2v2H8M6 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12V8M4 17h14v3M9 11h6M9 14h4" /></>}</svg>;
}
export function CardLegend() {
  return <details className="v2-card-legend"><summary aria-label="卡牌标识说明">标识</summary><div className="v2-legend-body"><div className="v2-type-key">{(['character', 'weapon', 'tactic'] as const).map(type => <span className={`v2-type-${type}`} key={type}><CardTypeIcon type={type} />{TYPES[type]}</span>)}</div><div className="v2-rarity-key">{(['common', 'rare', 'epic', 'legendary'] as const).map(rarity => <span className={`v2-rarity-${rarity}`} key={rarity}><i aria-hidden="true">{'◆'.repeat(RARITY_LEVEL[rarity])}</i>{RARITIES[rarity]}</span>)}</div><p>底色与图标表示类型，边框与刻度表示稀有度。完整效果请查看卡牌详情。</p></div></details>;
}
export const SKILL_NAMES: Record<string, string> = { xian_deng: '先登', zhen_jun: '振军', tong_dao: '同道', gu_feng: '孤锋', jun_xu: '军需', hui_xiang: '回响' };
export const SKILL_TEXT: Record<string, string> = { xian_deng: '本卡本场第一次主动出战，本次威力 +25。', zhen_jun: '本卡本场第一次主动出战，本次增幅 +2。', tong_dao: '与另一张同类型牌一同出战，本次威力 +30。', gu_feng: '本次出战仅有一张该类型牌时，本次增幅 +3。', jun_xu: '每场限一次，结算后获得 1 金币。', hui_xiang: '本卡本场第一次主动出战，原有技能额外结算一次。' };

export function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex="0"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]');
      if (!nodes?.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  return <div className="v2-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={`v2-modal ${wide ? 'v2-modal-wide' : ''}`}><header><h2 id={id}>{title}</h2><button aria-label="关闭" onClick={close}>关闭 ×</button></header><div className="v2-modal-body">{children}</div></div></div>;
}

export function CardFace({ definition, instance, compact = false, leader = false }: { definition: CardDef; instance?: CardInstance; compact?: boolean; leader?: boolean }) {
  const power = definition.power + (instance?.permanentPower ?? 0) + (instance?.temporaryPower ?? 0);
  const amp = definition.amp + (instance?.permanentAmp ?? 0) + (instance?.temporaryAmp ?? 0);
  const skillName = getCardSkillName(definition);
  const subtype = definition.profession ? PROFESSIONS[definition.profession] : definition.weaponClass ? WEAPONS[definition.weaponClass] : '';
  const enhancements = instance?.enhancementSkills ?? [];
  const hasSkills = !!(skillName || enhancements.length || instance?.chain);
  return <div data-card-definition={definition.id} data-card-instance={instance?.id} data-card-type={definition.type} data-card-rarity={definition.rarity} className={`v2-card-face v2-type-${definition.type} v2-rarity-${definition.rarity} ${compact ? 'v2-card-compact' : ''}`}>
    <div className="v2-card-top"><span className="v2-card-type"><CardTypeIcon type={definition.type} />{TYPES[definition.type]}</span><span className="v2-card-rarity"><i className="v2-rarity-marks" aria-hidden="true">{Array.from({ length: RARITY_LEVEL[definition.rarity] }, (_, index) => <i key={index} />)}</i>{RARITIES[definition.rarity]}</span></div>
    <CardArt definition={definition} className="v2-card-art" />
    {leader && <span className="v2-card-leader">先锋</span>}
    <strong className="v2-card-title"><span className="v2-card-name">{definition.name}</span>{subtype && <small>{subtype}</small>}</strong>
    <div className="v2-card-stats"><span className="v2-card-power">威力 {power}</span><span className="v2-card-amp">增幅 {amp}</span></div>
    {hasSkills && <div className="v2-card-skills">{skillName && <span className="v2-card-native-skill">技能：{skillName}</span>}{(enhancements.length > 0 || instance?.chain) && <div className="v2-card-enhancements">{enhancements.map(skill => <span key={skill}>{SKILL_NAMES[skill] ?? skill}</span>)}{instance?.chain && <span>连环</span>}</div>}</div>}
  </div>;
}

export function CardDetail({ definition, instance }: { definition: CardDef; instance?: CardInstance }) {
  const rule = getCardRuleText(definition);
  return <div className="v2-card-detail"><CardFace definition={definition} instance={instance} /><div><p className="v2-eyebrow">{RARITIES[definition.rarity]} · {TYPES[definition.type]} {definition.faction ? `· ${FACTIONS[definition.faction]}` : ''}</p><h3>{definition.name}</h3>{rule && <p className="v2-rule-text">{rule}</p>}<dl className="v2-stat-list"><div><dt>基础威力 / 增幅</dt><dd>{definition.power} / {definition.amp}</dd></div>{instance && <><div><dt>本局永久提升</dt><dd>威力 +{instance.permanentPower} · 增幅 +{instance.permanentAmp}</dd></div><div><dt>本场临时提升</dt><dd>威力 +{instance.temporaryPower} · 增幅 +{instance.temporaryAmp}</dd></div><div><dt>本场主动出战</dt><dd>{instance.plays} 次</dd></div>{instance.chain && <div><dt>连环</dt><dd>本场下次成功出战时，原技能额外结算一次后移除；战后清除</dd></div>}{instance.enhancementSkills.map(skill => <div key={skill}><dt>强化 · {SKILL_NAMES[skill] ?? skill}</dt><dd>{SKILL_TEXT[skill]}</dd></div>)}</>}</dl><p className="v2-muted">{AUTOMATIC_EQUIPMENT_TEXT}布阵产生的本次加成与敌阵修正，请查看战场伤害明细。</p></div></div>;
}

export function CharmBar({ state, send, inspect }: { state: RunState; send: (action: GameAction) => void; inspect: (id: string) => void }) {
  return <div className="v2-charm-bar" aria-label="三个常驻锦囊槽">{state.charms.map((charm, index) => <div className="v2-charm-slot" key={index}>{charm ? <><button className="v2-charm-info" data-charm-tier={isCampaign(state) ? ['Ⅰ', 'Ⅱ', 'Ⅲ'][charmTier(charm) - 1] : undefined} title={charmDefinition(state, charm.definitionId, charmTier(charm)).text} onClick={() => inspect(charm.definitionId)} aria-label={`锦囊 ${index + 1}：${charmDefinition(state, charm.definitionId).name}`}><CharmArt charmId={charm.definitionId} className="v2-charm-art" /><span>{charmDefinition(state, charm.definitionId).name}{isCampaign(state) ? ` ${['Ⅰ', 'Ⅱ', 'Ⅲ'][charmTier(charm) - 1]}` : ''}</span></button><div className="v2-charm-order">{index > 0 && <button aria-label={`锦囊 ${index + 1} 左移`} onClick={() => send({ type: 'moveCharm', from: index, to: index - 1 })}>‹</button>}{index < 2 && <button aria-label={`锦囊 ${index + 1} 右移`} onClick={() => send({ type: 'moveCharm', from: index, to: index + 1 })}>›</button>}</div></> : <span className="v2-muted">{['壹', '贰', '叁'][index]} · 锦囊空位</span>}</div>)}</div>;
}

export function OwnedCards({ state, onChoose, label = '查看', filter }: { state: RunState; onChoose: (id: string) => void; label?: string; filter?: (id: string) => boolean }) {
  return <div className="v2-owned-grid">{state.owned.filter(id => !state.removed.includes(id) && (!filter || filter(id))).map(id => { const instance = state.cards[id]!; const definition = CARD_MAP[instance.definitionId]!; return <button key={id} onClick={() => onChoose(id)} aria-label={`${label} ${definition.name}`}><CardFace definition={definition} instance={instance} compact leader={state.leaderId === id} /></button>; })}</div>;
}
