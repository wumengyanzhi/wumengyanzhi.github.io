import { charmDefinition, charmTier, isCampaign } from '../campaign';
import type { BattleReport, RunState } from '../model';
import { CharmArt } from './card-art';
import { useEffect, useRef } from 'react';

/** Read the engine's ordered charm breakdown rather than reimplementing its conditions. */
export function BattleCharms({ state, report, inspect, holdMs = 450 }: { state: RunState; report: BattleReport | null; inspect: (id: string) => void; holdMs?: number }) {
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const press = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => { clearTimeout(hold.current); hold.current = undefined; press.current = null; };
  const begin = (id: string, x: number, y: number) => { cancel(); press.current = { x, y }; hold.current = setTimeout(() => { press.current = null; inspect(id); }, holdMs); };
  const move = (x: number, y: number) => { if (press.current && Math.hypot(x - press.current.x, y - press.current.y) > 8) cancel(); };
  useEffect(() => () => { clearTimeout(hold.current); press.current = null; }, [state.revision]);
  const sources = report?.sources.filter(source => source.kind === 'charm') ?? [];
  return <>{state.charms.map((charm, index) => {
    if (!charm) return <div key={index} data-charm-slot={index} className="v2-rail-charm v2-rail-charm-empty" aria-label={`锦囊 ${index + 1} 空位`}><span aria-hidden="true">◇</span></div>;
    const tier = charmTier(charm), definition = charmDefinition(state, charm.definitionId, tier);
    const source = sources.find(item => item.label.startsWith(definition.name));
    const ready = !!source && !source.label.includes('未触发');
    const level = isCampaign(state) ? ['Ⅰ', 'Ⅱ', 'Ⅲ'][tier - 1] : '';
    return <article key={charm.id} data-charm-slot={index} data-charm-id={charm.id} data-charm-state={ready ? 'ready' : 'waiting'} className={`v2-rail-charm ${ready ? 'v2-charm-ready' : 'v2-charm-waiting'}`}>
      <button className="v2-charm-info" data-charm-tier={level || undefined} aria-label={`锦囊 ${index + 1}：${definition.name}`} title={definition.text} onClick={() => { cancel(); inspect(charm.definitionId); }}
        onPointerDown={event => { if (event.pointerType === 'touch') begin(charm.definitionId, event.clientX, event.clientY); }}
        onPointerMove={event => { if (event.pointerType === 'touch') move(event.clientX, event.clientY); }} onPointerUp={cancel} onPointerCancel={cancel}
        onTouchStart={event => { const first = event.touches[0]; if (event.touches.length === 1 && first) begin(charm.definitionId, first.clientX, first.clientY); else cancel(); }}
        onTouchMove={event => { const first = event.touches[0]; if (event.touches.length === 1 && first) move(first.clientX, first.clientY); else cancel(); }}
        onTouchEnd={cancel} onTouchCancel={cancel} onContextMenu={event => event.preventDefault()}>
        <CharmArt charmId={charm.definitionId} className="v2-charm-art" />
        <span className="v2-rail-charm-copy"><strong>{definition.name}<em>{level}</em></strong><small>锦囊 · {index + 1}</small></span>
        <span className="v2-rail-charm-state"><i aria-hidden="true">{ready ? '✓' : '◇'}</i><small>{ready ? '已生效' : '未满足'}</small></span>
      </button>
    </article>;
  })}</>;
}
