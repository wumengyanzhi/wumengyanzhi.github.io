import { useState } from 'react';
import type { CardDef, RunState } from '../model';
import { CARDS, CHARMS, DECKS } from '../data';
import { CardFace, TYPES } from './primitives';
import { CharmArt, EnemyArt } from './card-art';
import { DEFAULT_OPERATIONS } from './operation-settings';
import type { OperationSettings } from './operation-settings';
import { getCardRuleText } from './card-copy';
import { charmDefinition, enemiesFor, isCampaign } from '../campaign';

export interface Settings extends OperationSettings { animation: boolean; muted: boolean; music: number; effects: number; }
export interface HistoryEntry { id?: string; seed: string; deckId: string; difficulty: string; won: boolean; battles: number; gold: number; totalBattles?: number; finishedAt: number; }
export const SETTINGS_KEY = 'five-arrays-v2-settings';
export const HISTORY_KEY = 'five-arrays-v2-history';
export const DEFAULT_SETTINGS: Settings = { ...DEFAULT_OPERATIONS, animation: true, muted: false, music: 35, effects: 65 };

export function MainMenu({ resume, start, navigate, hasSave, tutorialLabel = '新手演武 · 两场学会破阵' }: { resume: () => void; start: () => void; navigate: (view: 'codex' | 'history' | 'settings' | 'tutorial') => void; hasSave: boolean; tutorialLabel?: string }) {
  return <main className="v2-main-menu">
    <div className="v2-menu-copy">
      <div className="v2-menu-kicker"><span>神话三国</span><i />三关十八局 · 五格成阵</div>
      <h1>五阵<span>破军</span></h1>
      <p className="v2-menu-tagline">将星入阵，寸兵成势。<br />在五格之间，破一场乱世。</p>
      <div className="v2-menu-actions">
        {hasSave && <button className="v2-primary" onClick={resume}>继续远征 <span aria-hidden="true">→</span></button>}
        <button className={hasSave ? 'v2-secondary' : 'v2-primary'} onClick={start} aria-label="踏上征途">开始远征 <span aria-hidden="true">→</span></button>
        <button className="v2-menu-training" onClick={() => navigate('tutorial')}>{tutorialLabel}<span aria-hidden="true">↗</span></button>
      </div>
      <nav className="v2-menu-nav" aria-label="场外功能">
        <button onClick={() => navigate('codex')}>万象图鉴<small>人物 · 兵器 · 战术</small></button>
        <button onClick={() => navigate('history')}>征战纪事<small>回望破阵之路</small></button>
        <button onClick={() => navigate('settings')}>操作与设置<small>操作 · 声音 · 存档</small></button>
      </nav>
      <footer className="v2-menu-footer">单人卡牌构筑 <b>◇</b> 本地自动保存</footer>
    </div>
    <div className="v2-menu-art" aria-hidden="true"><div className="v2-menu-stamp">运筹<br />帷幄</div><div className="v2-menu-art-caption"><span>三关问道</span><p>破阵无定式<br />谋定见山河</p></div></div>
  </main>;
}

const DECK_INTROS: Record<string, string> = {
  bai_zhan_cui_bing: '夏侯惇淬炼兵器，赵云双兵破阵。让人物与趁手的兵器相邻，积蓄一击之势。',
  lian_ce_yun_chou: '诸葛亮以不同战术成长，庞统为战术布下连环。筹划再次出战，让奇谋接续生效。',
  qi_zhen_qiang_xi: '弃牌为黄忠蓄势，孙尚香可消耗手牌兵器助攻。择机换牌，等待强袭的一手。',
};

export function NewRunScreen({ start, eliteUnlocked }: { start: (deckId: string, leaderId: string, seed: string, difficulty: 'standard' | 'elite') => void; eliteUnlocked: boolean }) {
  const [deckId, setDeckId] = useState(DECKS[0]!.id);
  const deck = DECKS.find(item => item.id === deckId)!;
  const [leaderId, setLeaderId] = useState(deck.leaders[0]!);
  const [seed] = useState(() => `五阵-${crypto.randomUUID()}`);
  const [difficulty, setDifficulty] = useState<'standard' | 'elite'>('standard');
  const leader = CARDS.find(card => card.id === leaderId)!;
  return <section className="v2-route-page v2-new-run">
    <p className="v2-eyebrow">三关十八局 · 起手三十张</p><h2>选择你的流派</h2>
    <p className="v2-route-intro">选定流派与先锋，即可启程。</p>
    <div className="v2-deck-options" role="group" aria-label="选择流派">{DECKS.map((option, index) => <button className={`v2-deck-option ${deckId === option.id ? 'v2-selected' : ''}`} aria-pressed={deckId === option.id} key={option.id} onClick={() => { setDeckId(option.id); setLeaderId(option.leaders[0]!); }}><span className="v2-deck-number">0{index + 1}</span><h3>{option.name}</h3><b>{option.subtitle}</b><p>{DECK_INTROS[option.id] ?? option.description}</p><small>18 人物 · 8 兵器 · 4 战术</small></button>)}</div>
    <div className="v2-new-run-bottom">
      <section className="v2-leader-selection" aria-labelledby="v2-choose-leader"><p className="v2-eyebrow">先锋入阵</p><h3 id="v2-choose-leader">选择先锋</h3><p>所选人物每战都会出现在八张起手中。</p><div className="v2-initial-leaders">{deck.leaders.map(id => { const definition = CARDS.find(card => card.id === id)!; return <button key={id} className={leaderId === id ? 'v2-selected' : ''} aria-pressed={leaderId === id} onClick={() => setLeaderId(id)} aria-label={`选择先锋 ${definition.name}`}><CardFace definition={definition} /><span>{getCardRuleText(definition)}</span></button>; })}</div></section>
      <section className="v2-start-panel" aria-labelledby="v2-expedition-ready"><p className="v2-eyebrow">整装待发</p><h3 id="v2-expedition-ready">{deck.name}</h3><p className="v2-start-leader">先锋 · {leader.name}</p><label>远征难度<select value={difficulty} onChange={event => setDifficulty(event.target.value as 'standard' | 'elite')}><option value="standard">标准远征</option>{eliteUnlocked && <option value="elite">精锐远征 · 敌阵耐久 +15%</option>}</select></label><p>每关六局，共十八局。每战 4 次出战、3 次弃牌；破阵后随机三选一强化，可花金币重抽，关键节点选卡、获取锦囊或进入军市。</p><button className="v2-primary" onClick={() => start(deck.id, leaderId, seed, difficulty)}>确认出征</button><small className="v2-local-save-note">进度自动保存在此设备</small></section>
    </div>
    <details className="v2-deck-list"><summary>查看「{deck.name}」全部 30 张起始牌</summary><p>{deck.cards.map(id => CARDS.find(card => card.id === id)?.name).join(' · ')}</p></details>
  </section>;
}

export function CodexScreen({ detail, state = null }: { detail: (definition: CardDef) => void; state?: RunState | null }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const cards = CARDS.filter(card => (filter === 'all' || card.type === filter || card.rarity === filter) && `${card.name}${getCardRuleText(card)}`.includes(search));
  return <section className="v2-route-page"><p className="v2-eyebrow">开放即知 · 无需解锁</p><h2>万象图鉴</h2><div className="v2-codex-filter"><input aria-label="搜索卡牌" placeholder="搜索名字或效果…" value={search} onChange={event => setSearch(event.target.value)} /><div>{[['all', '全部'], ['character', '人物'], ['weapon', '兵器'], ['tactic', '战术'], ['legendary', '传说'], ['charms', '锦囊'], ['enemies', '敌阵']].map(([id, label]) => <button key={id} className={filter === id ? 'v2-selected' : ''} onClick={() => setFilter(id!)}>{label}</button>)}</div></div>{filter === 'charms' ? <div className="v2-codex-charms">{CHARMS.map(item => <article key={item.id}><CharmArt charmId={item.id} className="v2-market-art" /><h3>{item.name}</h3><p>{charmDefinition(state, item.id, 1).text}</p>{(!state || isCampaign(state)) && <details><summary>查看Ⅱ / Ⅲ阶效果</summary><p>Ⅱ阶：{charmDefinition(state, item.id, 2).text}</p><p>Ⅲ阶：{charmDefinition(state, item.id, 3).text}</p></details>}<small>{item.starter ? '起手赠送' : `${charmDefinition(state, item.id, 1).price} 金 · 军市购入`}</small></article>)}</div> : filter === 'enemies' ? <div className="v2-codex-charms">{enemiesFor(state).map((item, index) => <article key={item.id}><EnemyArt enemyId={item.id} className="v2-market-art" /><h3>{!state || isCampaign(state) ? `第${Math.floor(index / 6) + 1}大关 · 第${index % 6 + 1}/6局` : `第${index + 1}/6战`} · {item.name}</h3><p>{item.text}</p><b>标准耐久 {item.hp}</b></article>)}</div> : <><p className="v2-muted">共 {cards.length} 张 · 点牌查看完整规则</p><div className="v2-codex-grid">{cards.map(definition => <button key={definition.id} aria-label={`查看 ${TYPES[definition.type]} ${definition.name}`} onClick={() => detail(definition)}><CardFace definition={definition} /></button>)}</div>{!cards.length && <p>暂无匹配牌面，请更换关键词。</p>}</>}</section>;
}

export function HistoryScreen({ history }: { history: HistoryEntry[] }) {
  return <section className="v2-route-page"><p className="v2-eyebrow">只记征途，不添战力</p><h2>征战纪事</h2><p>最近 20 局保存在此设备。</p>{history.length ? <div className="v2-history-list">{history.map((entry, index) => <article key={`${entry.seed}-${entry.finishedAt}-${index}`}><span className={entry.won ? 'v2-history-win' : ''}>{entry.won ? '破军' : '未竟'}</span><div><h3>{DECKS.find(deck => deck.id === entry.deckId)?.name ?? entry.deckId}</h3><p>{entry.battles} / {entry.totalBattles ?? 6} 阵告捷 · {entry.difficulty === 'elite' ? '精锐' : '标准'} · 余 {entry.gold} 金</p><small>{new Intl.DateTimeFormat('zh-CN').format(entry.finishedAt)}</small></div></article>)}</div> : <div className="v2-empty-state"><span>卷</span><p>尚无征战记录。第一段传奇，由你落笔。</p></div>}</section>;
}

export function TutorialScreen() {
  return <section className="v2-route-page v2-tutorial"><p className="v2-eyebrow">三分钟识五阵</p><h2>排一手，破一阵</h2><div className="v2-tutorial-steps">{[
    ['壹', '人物与兵器，紧邻便成阵', '把手牌拖进五格，或点手牌再点格位。兵器自动配属给左右紧邻的人物；两侧都有人物时，职业加成更高的一侧优先，同分选择左侧。空格会隔断配属，人物可以同时装备左右两件兵器。'],
    ['贰', '威力 × 增幅 = 一手伤害', '威力以朱红、增幅以青蓝显示。姓名旁是职业，牌面“技能”一行显示技能名称，完整效果在详情中。鼠标停留 1.5 秒或手机长按可查看详情，点“结算明细”查看本次伤害来源。'],
    ['叁', '四次出战，三次弃牌', '击破敌阵即可获胜。弃牌进入勾选模式，一次选择 1–5 张并补回，布阵不会清空。撤回与换位均不消耗出战。'],
    ['肆', '养成主力，再赴下一战', '首胜必得一名传说，每大关第1、3、5局可选新卡；非最终胜利获得一次随机三选一永久强化，可花2金起重抽，每次加价1金。每大关第 2、4 局后可在军市购买锦囊、升阶、锻造与精简牌组。'],
    ['伍', '先锋是起手的一员', '每战首手 8 张保证包含当前先锋。战间可更换先锋；删除或吞噬先锋后，需要重新指定。锦囊固定三槽，按槽序常驻生效。'],
    ['陆', '三关十八局，尽破即通关', '没有玩家血条；本战用尽出战仍未击破敌阵就会结束。存档在每次成功操作后自动保存，设置中可导出备份。'],
  ].map(([number, title, text]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></section>;
}

export function SettingsScreen({ settings, update, state, importSave, exportSave }: { settings: Settings; update: (value: Settings) => void; state: RunState | null; importSave: (text: string) => void; exportSave: () => string }) {
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState('');
  const [confirmImport, setConfirmImport] = useState(false);
  const download = () => {
    const serialized = exportSave();
    setText(serialized);
    const blob = new Blob([serialized], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `五阵破军-${state?.seed ?? '备份'}.json`; anchor.click(); URL.revokeObjectURL(url);
    setFeedback('备份已生成；也可复制下方文本保留。');
  };
  return <section className="v2-route-page v2-settings"><p className="v2-eyebrow">随心而战</p><h2>操作与设置</h2><h3>操作与拖动</h3><p>鼠标停留 1.5 秒查看详情，按住移动拖牌；手机长按查看，移动后拖牌。也可点选手牌，再点格位布阵。</p><div className="v2-settings-controls v2-operation-settings"><label><span>启用卡牌拖动<small>支持上阵、换位、回手与手牌排序</small></span><input type="checkbox" checked={settings.dragEnabled} onChange={event => update({ ...settings, dragEnabled: event.target.checked })} /></label><label><span>鼠标拖动灵敏度<small>稳妥模式需要稍多移动，减少误拖</small></span><select aria-label="鼠标拖动灵敏度" disabled={!settings.dragEnabled} value={settings.dragSensitivity} onChange={event => update({ ...settings, dragSensitivity: event.target.value as Settings['dragSensitivity'] })}><option value="responsive">灵敏</option><option value="balanced">均衡</option><option value="steady">稳妥</option></select></label><label><span>手机长按速度<small>停留查看详情，移动后进入拖牌</small></span><select aria-label="手机长按速度" disabled={!settings.dragEnabled} value={settings.touchHoldMs} onChange={event => update({ ...settings, touchHoldMs: Number(event.target.value) as Settings['touchHoldMs'] })}><option value={200}>较快</option><option value={300}>标准</option><option value={450}>更稳</option></select></label><label><span>格位轻微吸附<small>松在格位边缘时，帮助对准落点</small></span><input type="checkbox" checked={settings.snapEnabled} disabled={!settings.dragEnabled} onChange={event => update({ ...settings, snapEnabled: event.target.checked })} /></label><label><span>拖动时预览伤害<small>只预排阵型，松手后才确认位置</small></span><input type="checkbox" checked={settings.dragPreview} disabled={!settings.dragEnabled} onChange={event => update({ ...settings, dragPreview: event.target.checked })} /></label><label><span>双击快捷布阵<small>双击手牌到首个空位；双击阵中牌回手</small></span><input type="checkbox" checked={settings.doubleClickPlace} onChange={event => update({ ...settings, doubleClickPlace: event.target.checked })} /></label></div><button onClick={() => update({ ...settings, ...DEFAULT_OPERATIONS })}>恢复默认操作</button><p className="v2-muted">拖到无效区域或按 Esc 取消，不会消耗次数。操作偏好只保存在当前浏览器。</p><h3>声音与表现</h3><div className="v2-settings-controls"><label><span>静音<small>所有声音均有文字提示</small></span><input type="checkbox" checked={settings.muted} onChange={event => update({ ...settings, muted: event.target.checked })} /></label><label><span>战场音乐 <b>{settings.music}%</b></span><input type="range" min="0" max="100" value={settings.music} onChange={event => update({ ...settings, music: Number(event.target.value) })} /></label><label><span>操作音效 <b>{settings.effects}%</b></span><input type="range" min="0" max="100" value={settings.effects} onChange={event => update({ ...settings, effects: Number(event.target.value) })} /></label><label><span>开启动效<small>关闭后直接显示规则结果</small></span><input type="checkbox" checked={settings.animation} onChange={event => update({ ...settings, animation: event.target.checked })} /></label></div><h3>本地存档备份</h3><p>存档只保存在本设备。导入将替换当前局；校验失败会保留原档。</p><div className="v2-save-buttons"><button onClick={download}>导出当前远征</button><label className="v2-file-label">读取备份文件<input type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void file.text().then(value => { setText(value); setFeedback('已读取文件，请检查后导入。'); }); }} /></label></div><textarea aria-label="存档备份文本" placeholder="粘贴备份存档，或导出后复制文本" value={text} onChange={event => { setText(event.target.value); setConfirmImport(false); }} rows={7} /><button disabled={!text.trim()} className={confirmImport ? 'v2-primary' : ''} onClick={() => { if (!confirmImport) { setConfirmImport(true); setFeedback('再次点击确认导入：当前远征将被替换。'); } else { importSave(text); setConfirmImport(false); } }}>{confirmImport ? '确认替换并导入' : '导入备份'}</button>{feedback && <p role="status">{feedback}</p>}</section>;
}
