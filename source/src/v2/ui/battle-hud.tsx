import { enemiesFor, isCampaign } from '../campaign';
import type { BattleReport, RunState } from '../model';
import { EnemyArt } from './card-art';
import { BossIntel } from './boss-intel';
import { EnemyHealth } from './combat-feedback';

export function BattleIcon({ kind }: { kind: 'menu' | 'settings' | 'recall' | 'deck' | 'report' }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'menu' && <path d="M4 6h16M4 12h16M4 18h16" />}
    {kind === 'settings' && <><path d="m9 3 1-2h4l1 2 3 2 2 1v4l-1 2 1 2v4l-2 1-3 2-1 2h-4l-1-2-3-2-2-1v-4l1-2-1-2V6l2-1z" transform="translate(0 0) scale(1 .95)" /><circle cx="12" cy="11.5" r="3.5" /></>}
    {kind === 'recall' && <path d="m9 5-6 6 6 6M4 11h10a6 6 0 0 1 0 12" transform="translate(0 -3)" />}
    {kind === 'deck' && <><path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5" /></>}
    {kind === 'report' && <><path d="M5 3h14v18H5zM9 7h6M9 11h6M9 15h3" /></>}
  </svg>;
}

interface Props {
  state: RunState; previewState: RunState; report: BattleReport | null; health: number;
  teaching: boolean; animation: boolean; onBoss: () => void; onMenu?: () => void; onSettings?: () => void;
}
export function BattleHud({ state, previewState, report, health, teaching, animation, onBoss, onMenu, onSettings }: Props) {
  const battle = state.battle!, enemy = enemiesFor(state).find(item => item.id === battle.enemyId)!;
  const stage = teaching ? `演武${state.battleIndex + 1}` : isCampaign(state) ? `${Math.floor(state.battleIndex / 6) + 1}-${state.battleIndex % 6 + 1}` : `${state.battleIndex + 1}`;
  return <header className="v2-battle-hud" data-battle-region="hud">
    <section className="v2-enemy" aria-label="敌阵">
      <button className="v2-stage-badge" aria-label={`当前关卡 ${stage}，查看行程`} onClick={onBoss}>{stage}</button>
      <EnemyArt enemyId={enemy.id} className="v2-enemy-art" />
      <div className="v2-enemy-copy v2-enemy-main">
        <div className="v2-enemy-title"><h2>{teaching ? '演武木阵' : enemy.name}</h2>{enemy.kind === 'boss' && !teaching && <span className="v2-enemy-kind">BOSS</span>}</div>
        <EnemyHealth enemyId={enemy.id} hp={battle.hp} maxHp={health} playCount={battle.completedPlays} damage={state.currentReports.at(-1)?.actualDamage ?? 0} forecastDamage={report?.actualDamage ?? 0} animate={animation} />
        <div className="v2-hud-intel">{!teaching && <BossIntel state={previewState} live compact onInspect={onBoss} />}</div>
      </div>
    </section>
    <div className="v2-hud-tools">
      {onMenu ? <button className="v2-hud-wordmark" aria-label="五阵破军，打开战场菜单" onClick={onMenu}>五阵破军</button> : <span className="v2-hud-wordmark">五阵破军</span>}
      <span className="v2-hud-gold" aria-label={`金币 ${state.gold}`}><i aria-hidden="true">金</i>{state.gold}</span>
      {onMenu && <button className="v2-hud-icon" aria-label="战场菜单" onClick={onMenu}><BattleIcon kind="menu" /></button>}
      {onSettings && <button className="v2-hud-icon" aria-label="打开设置" onClick={onSettings}><BattleIcon kind="settings" /></button>}
    </div>
  </header>;
}
