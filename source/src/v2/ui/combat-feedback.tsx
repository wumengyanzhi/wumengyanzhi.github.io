import { useEffect, useRef, useState } from 'react';

interface HealthProps { enemyId: string; hp: number; maxHp: number; playCount: number; damage: number; forecastDamage?: number; animate?: boolean; }
export function EnemyHealth({ enemyId, hp, maxHp, playCount, damage, forecastDamage = 0, animate = true }: HealthProps) {
  const [trail, setTrail] = useState(hp);
  const [hit, setHit] = useState<{ key: number; damage: number } | null>(null);
  const previous = useRef({ enemyId, hp, playCount });
  const reduced = !animate || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const before = previous.current;
    previous.current = { enemyId, hp, playCount };
    const isHit = before.enemyId === enemyId && playCount > before.playCount && hp < before.hp && damage > 0;
    if (!isHit) { setTrail(hp); setHit(null); return; }
    setTrail(reduced ? hp : before.hp);
    setHit({ key: playCount, damage: before.hp - hp });
    const chase = setTimeout(() => setTrail(hp), reduced ? 0 : 320);
    const clear = setTimeout(() => setHit(null), 1250);
    return () => { clearTimeout(chase); clearTimeout(clear); };
  }, [enemyId, hp, playCount, damage, reduced]);
  const percent = (value: number) => Math.max(0, Math.min(100, value / Math.max(1, maxHp) * 100));
  const forecast = Math.min(hp, Math.max(0, forecastDamage));
  return <div className={`v2-enemy-health v2-health-emphasis ${hit ? 'v2-health-hit' : ''}`} data-effects={reduced ? 'off' : 'on'}>
    <span className="v2-health-caption">敌阵血量</span>
    <div role="meter" aria-label="敌阵耐久" aria-valuenow={hp} aria-valuemin={0} aria-valuemax={maxHp} className="v2-hp-track">
      <i data-testid="v2-hp-trail" className="v2-hp-trail" style={{ width: `${percent(trail)}%` }} />
      <i className="v2-hp-fill" style={{ width: `${percent(hp)}%` }} />
      {forecast > 0 && <i className="v2-hp-forecast" aria-hidden="true" style={{ left: `${percent(hp - forecast)}%`, width: `${percent(forecast)}%` }} />}
    </div>
    <strong className="v2-health-number">{hp.toLocaleString()}<small> / {maxHp.toLocaleString()}</small></strong>
    {hit && <span key={`${enemyId}:${hit.key}`} className="v2-hit-number" aria-label="敌阵受击" role="status">−{hit.damage.toLocaleString()}</span>}
  </div>;
}

export interface BreakImpactEvent { id: string; damage: number; }
/** Survives the battle-to-reward transition; does not delay or intercept commands. */
export function BreakImpact({ event, clear }: { event: BreakImpactEvent | null; clear: () => void }) {
  const clearRef = useRef(clear);
  clearRef.current = clear;
  useEffect(() => {
    if (!event) return;
    const timer = setTimeout(() => clearRef.current(), 1150);
    return () => clearTimeout(timer);
  }, [event]);
  return event && <div key={event.id} className="v2-break-impact" role="status" aria-label="破阵反馈"><span>击破</span><strong>{event.damage.toLocaleString()}</strong><small>伤害 · 敌阵崩解</small></div>;
}
