import { CARD_MAP, MATCH_MATRIX } from '../data';
import { MATCH_MATRIX as LEGACY_MATRIX } from '../legacy/data';
import { isCampaign } from '../campaign';
import { getEquipment, previewBattle } from '../battle';
import type { Profession, RunState, WeaponClass } from '../model';
import { CardFace, PROFESSIONS, WEAPONS } from './primitives';

export function BattleOverview({ state, choose }: { state: RunState; choose: (id: string) => void }) {
  const matrix = isCampaign(state) ? MATCH_MATRIX : LEGACY_MATRIX;
  const professions = Object.keys(PROFESSIONS) as Profession[];
  const weapons = Object.keys(WEAPONS) as WeaponClass[];
  const equipment = getEquipment(state);
  const preview = previewBattle(state);
  const report = preview.report;
  const number = (value: number) => `${value > 0 ? '+' : ''}${Number(value.toFixed(4))}`;
  return <div className="v2-battle-overview">
    <h3>职业与兵器加成</h3>
    <p>每组实际装备关系增加的增幅：本职 +4，其余适配 +1 / +2；“—”表示无职业加成，兵器自身数值照常计入。</p>
    <div className="v2-match-table-scroll"><table aria-label="职业与兵器增幅加成"><thead><tr><th scope="col">职业</th>{weapons.map(weapon => <th scope="col" key={weapon}>{WEAPONS[weapon]}</th>)}</tr></thead><tbody>{professions.map(profession => <tr key={profession}><th scope="row">{PROFESSIONS[profession]}</th>{weapons.map(weapon => <td className={matrix[profession][weapon] === 4 ? 'v2-match-primary' : matrix[profession][weapon] ? 'v2-match-secondary' : ''} key={weapon}>{matrix[profession][weapon] ? `+${matrix[profession][weapon]}` : '—'}</td>)}</tr>)}</tbody></table></div>
    <p className="v2-overview-rule">兵器必须紧邻人物才会自动装备；两侧都有人物时，选择职业加成更高者，同分优先左侧。一名人物可以同时装备左右两件兵器，逐件计算加成。</p>
    <h3>本次实际配属</h3>
    {Object.keys(equipment).length ? <ul>{Object.entries(equipment).map(([weapon, owner]) => {
      const w = CARD_MAP[state.cards[weapon]!.definitionId]!, c = CARD_MAP[state.cards[owner]!.definitionId]!;
      const bonus = c.profession && w.weaponClass ? matrix[c.profession][w.weaponClass] : 0;
      return <li key={weapon}>{w.name} → {c.name} <b>职业增幅 +{bonus}</b></li>;
    })}</ul> : <p>暂无实际配属；在布阵区把兵器放到人物旁边后查看。</p>}
    <h3>本次加成与削弱</h3>
    <p>基础增幅 1{isCampaign(state) ? `，跨关成长额外 +${state.baseAmp ?? 0}` : ''}。以下读取当前伤害预览，包含已生效的职业、军势、技能、锦囊及敌阵影响。</p>
    {report ? <><p className="v2-overview-equation">{report.power} 威力 × {report.amp} 增幅 = <strong>{report.damage.toLocaleString()}</strong></p><div className="v2-overview-sources">{report.sources.filter(source => source.kind !== 'cards').map((source, index) => <div key={index}><span>{source.label}</span><b>{source.power ? `威力 ${number(source.power)} ` : ''}{source.multiplier ? `增幅 ×${source.multiplier}${source.amp ? `（净变化 ${number(source.amp)}）` : ''}` : source.amp ? `增幅 ${number(source.amp)}` : ''}</b></div>)}</div><p>锦囊按槽位从左到右结算；增幅 +N 是加法，增幅 ×N 放大此前增幅。最终伤害按规则取整。</p></> : <p>{preview.error ?? '先布置至少一张牌，便可查看当前加成。'}</p>}
    <details className="v2-overview-hand" open><summary>手牌速览 · {state.battle!.hand.length} 张</summary><div className="v2-overview-grid">{state.battle!.hand.map(id => <button key={id} onClick={() => choose(id)}><CardFace definition={CARD_MAP[state.cards[id]!.definitionId]!} instance={state.cards[id]!} compact /></button>)}</div><p>点选手牌返回战场，再点击格位布阵。</p></details>
  </div>;
}
