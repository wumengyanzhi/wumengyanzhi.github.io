import { PlayResult } from './play-result';
import type { GameAction, RunState } from '../model';
import { CARD_MAP, DECKS } from '../data';
import { validLeaders } from '../engine';
import { charmDefinition, charmTier, enemiesFor, isCampaign, positionLabel } from '../campaign';
import { BossIntel } from './boss-intel';
import { CardFace, CharmBar } from './primitives';
import { CharmArt, EnemyArt } from './card-art';

interface Props { state: RunState; send: (action: GameAction) => void; detail: (id: string) => void; charm: (id: string) => void; }

export { RewardScreen } from './reward-screen';

export { MarketScreen } from './market-screen';

export function CampScreen({ state, send, detail, charm }: Props) {
  const leaders = validLeaders(state);
  const next = enemiesFor(state)[state.battleIndex + 1];
  return <section className="v2-route-page v2-camp"><p className="v2-eyebrow">整军待发 · 下一程</p><h2>旌旗再起</h2>{next && <div className="v2-camp-enemy"><EnemyArt enemyId={next.id} className="v2-camp-enemy-art" /><div><span>{positionLabel(state, state.battleIndex + 1)}</span><h3>{next.name}</h3><p>耐久 {Math.ceil(next.hp * (state.difficulty === 'elite' ? 1.15 : 1)).toLocaleString()}</p>{next.kind !== 'boss' && <p>{next.text}</p>}</div></div>}<BossIntel state={state} index={state.battleIndex + 1} /><CharmBar state={state} send={send} inspect={charm} /><h3>先锋首手保底</h3><p>先锋属于八张起手中的一张。每战重新保证入手，不提供额外被动。</p>{leaders.length > 0 ? <div className="v2-leader-options">{leaders.map(id => <div key={id}><button className={`v2-leader-option ${state.leaderId === id ? 'v2-selected' : ''}`} onClick={() => send({ type: 'setLeader', cardId: id })}><CardFace definition={CARD_MAP[state.cards[id]!.definitionId]!} instance={state.cards[id]!} leader={state.leaderId === id} /></button><button onClick={() => detail(id)}>查看详情</button></div>)}</div> : <p>牌组没有人物，本战无先锋保底。</p>}{!state.leaderId && leaders.length > 0 && <p role="alert" className="v2-warning">先锋已失效，请先选择一名合法人物。</p>}<button className="v2-primary v2-route-continue" disabled={leaders.length > 0 && !leaders.includes(state.leaderId ?? '')} onClick={() => send({ type: 'nextBattle' })}>迎战下一阵 →</button></section>;
}

export function ResultScreen({ state, restart, menu }: { state: RunState; restart: () => void; menu: () => void }) {
  const won = state.phase === 'won';
  const reports = state.battles.flatMap(battle => battle.reports);
  const best = [...reports].sort((a, b) => b.damage - a.damage)[0];
  const plays = state.battles.reduce((sum, battle) => sum + battle.plays, 0);
  const leader = state.leaderId ? state.cards[state.leaderId] : null;
  return <section className={`v2-route-page v2-result ${won ? 'v2-victory' : ''}`}><span className="v2-result-seal">{won ? '破军' : '再起'}</span><p className="v2-eyebrow">{won ? isCampaign(state) ? '三关十八阵尽破 · 山河重开' : '六阵尽破 · 山河重开' : '兵家胜败 · 来日再战'}</p><h2>{won ? '一战定山河' : '此役未竟'}</h2><p className="v2-route-intro">{won ? '五格之间，你已写下自己的破阵之道。' : `止步于${positionLabel(state)}。敌阵尚余 ${state.battles.at(-1)?.remainingHp.toLocaleString() ?? 0} 耐久，下一次调整配属与出战节奏再试。`}</p><div className="v2-result-stats"><div><small>破阵</small><strong>{state.battles.filter(item => item.won).length} / {enemiesFor(state).length}</strong></div><div><small>出战</small><strong>{plays} 手</strong></div><div><small>最高单手</small><strong>{best?.damage.toLocaleString() ?? 0}</strong></div></div><p>{DECKS.find(deck => deck.id === state.deckId)?.name} · {leader ? CARD_MAP[leader.definitionId]!.name : '无先锋'} · {state.difficulty === 'elite' ? '精锐' : '标准'}</p><div className="v2-result-charms">{state.charms.map((item, index) => item && <span key={index}><CharmArt charmId={item.definitionId} className="v2-charm-art" />{charmDefinition(state, item.definitionId).name}{isCampaign(state) ? ` ${['Ⅰ', 'Ⅱ', 'Ⅲ'][charmTier(item) - 1]}` : ''}</span>)}</div>{best && <details><summary>关键一手 · {best.power} 威力 × {best.amp} 增幅</summary><p>{best.notes.join(' · ') || '通过人物、装备与军势相互配合完成结算。'}</p></details>}<PlayResult report={state.battles.at(-1)?.reports.at(-1)} /><div className="v2-result-records">{state.battles.map(item => <div key={item.index}><span>{positionLabel(state, item.index)} · {enemiesFor(state).find(enemy => enemy.id === item.enemyId)?.name}</span><b>{item.won ? '破阵' : '失利'} · {item.plays} 手</b></div>)}</div>{won && <p className="v2-gold-text">{isCampaign(state) ? '三关十八局远征已完成' : plays <= 12 ? '挑战达成 · 十二手内通关' : '六战远征已完成'}{state.market?.rerolls === 0 ? ' · 未刷新最终军市' : ''}</p>}<p className="v2-muted">征战记录保存在此设备，可从主菜单查看。</p><button className="v2-primary" onClick={restart}>再启征途</button><button onClick={menu}>返回主菜单</button></section>;
}
