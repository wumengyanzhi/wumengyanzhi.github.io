import { useEffect, useRef, useState } from 'react';
import type { CardDef, GameAction, RunState } from '../model';
import { CARD_MAP, DECKS } from '../data';
import { act, createRun } from '../engine';
import { charmDefinition, charmTier, enemiesFor, isCampaign } from '../campaign';
import { CampaignProgress } from './campaign-progress';
import { CharmRewardScreen } from './charm-reward-screen';
import { parseRun, SAVE_KEY, serializeRun } from '../persistence';
import { BattleScreen } from './battle-screen';
import { CampScreen, MarketScreen, ResultScreen, RewardScreen } from './campaign-screens';
import { CardDetail, Modal, OwnedCards } from './primitives';
import { CodexScreen, DEFAULT_SETTINGS, HISTORY_KEY, HistoryScreen, MainMenu, NewRunScreen, SETTINGS_KEY, SettingsScreen } from './menu-screens';
import type { HistoryEntry, Settings } from './menu-screens';
import './game.css';
import './battle-layout.css';
import './card-identity.css';
import './release-shell.css';
import './fixed-battle.css';
import './combat-readability.css';
import './command-battle.css';
import './game-fonts.css';
import { BreakImpact } from './combat-feedback';
import type { BreakImpactEvent } from './combat-feedback';
import { CardInspector } from './card-inspector';
import { normalizeOperations } from './operation-settings';
import { useTutorial } from './use-tutorial';
import { InteractiveTutorial } from './tutorial-screen';
import { ONBOARDING_KEY, shouldOfferTutorial } from './first-visit';

type View = 'menu' | 'new' | 'game' | 'codex' | 'history' | 'settings' | 'tutorial';
function savedRun(): { state: RunState | null; raw: string | null; error: string } {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SAVE_KEY); return { state: raw ? parseRun(raw) : null, raw, error: '' }; }
  catch { return { state: null, raw, error: '当前存档无法读取，原始内容已保留。可在设置导出备份或导入有效存档。' }; }
}
function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    return { ...normalizeOperations(raw), animation: typeof raw.animation === 'boolean' ? raw.animation : true, muted: typeof raw.muted === 'boolean' ? raw.muted : false, music: typeof raw.music === 'number' ? Math.max(0, Math.min(100, raw.music)) : 35, effects: typeof raw.effects === 'number' ? Math.max(0, Math.min(100, raw.effects)) : 65 };
  } catch { return DEFAULT_SETTINGS; }
}
function loadHistory(): HistoryEntry[] { try { const raw: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); return Array.isArray(raw) ? raw.filter((entry): entry is HistoryEntry => !!entry && typeof entry === 'object' && typeof entry.seed === 'string' && typeof entry.won === 'boolean').slice(0, 20) : []; } catch { return []; } }
function sound(kind: string) { window.dispatchEvent(new CustomEvent('v2:sound', { detail: { kind } })); }

export default function GameApp({ initialState }: { initialState?: RunState } = {}) {
  const [loaded] = useState(savedRun);
  const baseline = useRef(loaded.raw);
  const [state, setState] = useState<RunState | null>(initialState ?? loaded.state);
  const [view, setView] = useState<View>(initialState ? 'game' : 'menu');
  const [previousView, setPreviousView] = useState<View>('menu');
  const [error, setError] = useState(loaded.error);
  const [notice, setNotice] = useState('');
  const [impact, setImpact] = useState<BreakImpactEvent | null>(null);
  const [settings, setSettings] = useState(loadSettings);
  const [history, setHistory] = useState(loadHistory);
  const [cardDetail, setCardDetail] = useState<{ definition: CardDef; instanceId?: string } | null>(null);
  const [charmDetail, setCharmDetail] = useState<string | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);
  const [replacePending, setReplacePending] = useState<Parameters<typeof createRun> | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [loadEpoch, setLoadEpoch] = useState(0);
  const [welcomeOpen, setWelcomeOpen] = useState(() => !initialState && shouldOfferTutorial(localStorage));
  const [welcomeError, setWelcomeError] = useState('');
  const tutorial = useTutorial();
  const visibleState = view === 'tutorial' ? tutorial.session?.run : state;
  const inspectedCharm = visibleState?.charms.find(charm => charm?.definitionId === charmDetail);
  const recordInspection = view === 'tutorial'
    ? (definitionId: string) => tutorial.dispatch({ type: 'inspect', definitionId }) : undefined;
  useEffect(() => { window.dispatchEvent(new CustomEvent('v2:phase', { detail: { phase: view === 'game' ? state?.phase ?? 'menu' : 'menu', battleIndex: state?.battleIndex ?? 0 } })); }, [state?.phase, state?.battleIndex, view]);
  useEffect(() => { window.dispatchEvent(new CustomEvent('v2:settings', { detail: settings })); }, [settings]);
  useEffect(() => {
    if (!state || !['won', 'lost'].includes(state.phase)) return;
    try {
      const previous = loadHistory();
      if (previous.some(entry => entry.id === state.runId)) return;
      const entry: HistoryEntry = { id: state.runId, seed: state.seed, deckId: state.deckId, difficulty: state.difficulty, won: state.phase === 'won', battles: state.battles.filter(item => item.won).length, gold: state.gold, totalBattles: enemiesFor(state).length, finishedAt: Date.now() };
      const next = [entry, ...previous].slice(0, 20);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); setHistory(next);
    } catch { setError('本局结果仍在存档中，但征战记录未能写入。请导出当前远征备份。'); }
  }, [state]);
  const commit = (next: RunState): boolean => {
    try { const serialized = serializeRun(next); localStorage.setItem(SAVE_KEY, serialized); baseline.current = serialized; setState(next); setError(''); return true; }
    catch (cause) { setError(`保存失败，操作尚未生效：${cause instanceof Error ? cause.message : '设备存储不可用'}。可导出备份后再试。`); return false; }
  };
  const send = (action: GameAction) => {
    if (!state) return;
    try {
      if (localStorage.getItem(SAVE_KEY) !== baseline.current) { setConflict(true); return; }
      const result = act(state, action, `ui:${state.seed}:${state.revision}:${action.type}`);
      if (!result.ok) { setError(result.error ?? '这一步暂不可用。'); return; }
      if (commit(result.state)) {
        const victory = result.state.battles.at(-1);
        if (action.type === 'play' && result.state.phase !== 'battle' && victory?.won) {
          const report = victory.reports.at(-1);
          if (report) setImpact({ id: `${result.state.runId}:${result.state.revision}`, damage: report.damage });
        }
        setNotice(action.type === 'play' ? '已结算本次出战' : action.type === 'discard' ? '已弃牌并补充手牌' : action.type === 'chooseCard' ? action.definitionId ? '新卡已收入牌组，继续选择强化' : '已跳过新卡，继续选择强化' : action.type === 'chooseEnhancement' ? '永久强化已完成' : action.type === 'buyCharm' ? '锦囊交易完成' : '已自动保存');
        sound(result.state.phase === 'won' ? 'win' : result.state.phase === 'lost' ? 'lose' : action.type === 'play' ? 'play' : action.type === 'discard' ? 'discard' : ['chooseCard', 'chooseEnhancement'].includes(action.type) ? 'reward' : ['buyCharm', 'forge', 'removeCard'].includes(action.type) ? 'buy' : 'click');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作未完成，当前状态已保留。'); }
  };
  const inspect = (id: string) => {
    const instance = visibleState?.cards[id];
    const definition = CARD_MAP[instance?.definitionId ?? id];
    if (definition) { recordInspection?.(definition.id); setCardDetail({ definition, instanceId: instance ? id : undefined }); }
  };
  const start = (...args: Parameters<typeof createRun>) => {
    try { const next = createRun(...args); next.runId = crypto.randomUUID(); if (commit(next)) { setLoadEpoch(epoch => epoch + 1); setView('game'); setNotice('先锋已进入首手。点选手牌，再点格位开始布阵。'); sound('click'); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法开始远征。'); }
  };
  const requestStart = (deckId: string, leaderId: string, seed: string, difficulty: 'standard' | 'elite') => {
    const args: Parameters<typeof createRun> = [deckId, leaderId, seed, difficulty];
    let hasExisting = !!state; try { hasExisting ||= !!localStorage.getItem(SAVE_KEY); } catch { /* commit will explain unavailable storage */ }
    if (hasExisting) setReplacePending(args); else start(...args);
  };
  const navigate = (target: View) => { setPreviousView(view === 'game' ? 'game' : 'menu'); setView(target); sound('click'); };
  const updateSettings = (next: Settings) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); setSettings(next); } catch { setError('设置无法保存，请检查设备存储。'); } };
  const importSave = (text: string) => { try { const next = parseRun(text); const previous = localStorage.getItem(SAVE_KEY); if (previous) localStorage.setItem(`${SAVE_KEY}.before-import`, previous); if (commit(next)) { setLoadEpoch(epoch => epoch + 1); setView('game'); setNotice('存档导入成功；导入前的原档已另存为本地备份。'); } } catch (cause) { setError(`导入失败，原档已保留：${cause instanceof Error ? cause.message : '文件无效'}`); } };
  const exportSave = () => { try { return state ? serializeRun(state) : localStorage.getItem(SAVE_KEY) ?? ''; } catch { return ''; } };
  const screenProps = state ? { state, send, detail: inspect, charm: setCharmDetail } : null;
  const answerWelcome = (learn: boolean) => {
    try { localStorage.setItem(ONBOARDING_KEY, learn ? 'accepted' : 'declined'); }
    catch { setWelcomeError('选择未能保存，请检查设备存储后重试。'); return; }
    setWelcomeError(''); setWelcomeOpen(false);
    if (learn) { tutorial.dispatch({ type: 'next' }); setView('tutorial'); }
  };
  return <CardInspector disabled={view === 'tutorial' && !['intro', 'practice', 'complete', 'skipped'].includes(tutorial.session?.step ?? 'intro')} cards={visibleState?.cards} holdMs={settings.touchHoldMs} onInspect={recordInspection} contextKey={`${view}-${loadEpoch}-${tutorial.epoch}-${visibleState?.revision ?? 0}-${!!cardDetail}-${deckOpen}`}><div className={`v2-app ${view === 'game' && state?.phase === 'battle' ? 'v2-in-battle' : ''} ${settings.animation ? '' : 'v2-reduced-motion'}`}><div className="v2-app-content" inert={welcomeOpen} aria-hidden={welcomeOpen ? true : undefined}>
    {view !== 'menu' && !(view === 'game' && state?.phase === 'battle') && <header className="v2-topbar"><button className="v2-wordmark" onClick={() => view === 'game' ? setExitOpen(true) : setView('menu')}>五阵<span>破军</span></button>{view === 'game' && state ? <><CampaignProgress state={state} /><div className="v2-topbar-tools"><button onClick={() => setDeckOpen(true)}>牌库 {state.owned.filter(id => !state.removed.includes(id)).length}</button><button aria-label="打开设置" onClick={() => navigate('settings')}>设置</button></div></> : <button onClick={() => setView(previousView)}>← 返回{previousView === 'game' ? '远征' : '主菜单'}</button>}</header>}
    {error && <div className="v2-error" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={() => setError('')}>×</button></div>}
    {view === 'menu' && <MainMenu hasSave={!!state} resume={() => setView('game')} start={() => navigate('new')} navigate={navigate} tutorialLabel={tutorial.session && !['intro', 'complete', 'skipped'].includes(tutorial.session.step) ? '继续演武 · 新手教学' : '新手演武 · 两场学会破阵'} />}
    {view === 'new' && <NewRunScreen start={requestStart} eliteUnlocked={history.some(item => item.won)} />}
    {view === 'codex' && <CodexScreen state={state} detail={definition => setCardDetail({ definition })} />}
    {view === 'history' && <HistoryScreen history={history} />}
    {view === 'tutorial' && <InteractiveTutorial {...tutorial} settings={settings} detail={inspect} charm={setCharmDetail} exit={() => setView('menu')} expedition={() => navigate('new')} />}
    {view === 'settings' && <SettingsScreen settings={settings} update={updateSettings} state={state} importSave={importSave} exportSave={exportSave} />}
    {view === 'game' && state && screenProps && <><div className="v2-game-body">{state.phase === 'battle' && <BattleScreen key={`battle-${loadEpoch}-${state.runId}-${state.battleIndex}`} {...screenProps} settings={settings} onMenu={() => setExitOpen(true)} onSettings={() => navigate('settings')} onDeck={() => setDeckOpen(true)} />}{['cardReward', 'enhanceReward'].includes(state.phase) && <RewardScreen {...screenProps} />}{state.phase === 'market' && <MarketScreen key={`market-${loadEpoch}-${state.runId}-${state.battleIndex}`} {...screenProps} />}{state.phase === 'charmReward' && <CharmRewardScreen key={state.charmReward?.id} state={state} send={send} />}{state.phase === 'camp' && <CampScreen {...screenProps} />}{['won', 'lost'].includes(state.phase) && <ResultScreen state={state} restart={() => navigate('new')} menu={() => setView('menu')} />}</div><div className="v2-save-status" role="status" aria-live="polite">{notice || '本地自动保存'} · {DECKS.find(deck => deck.id === state.deckId)?.name}</div></>}
    {cardDetail && <Modal title={cardDetail.definition.name} close={() => setCardDetail(null)}><CardDetail definition={cardDetail.definition} instance={cardDetail.instanceId ? visibleState?.cards[cardDetail.instanceId] : undefined} /></Modal>}
    {charmDetail && charmDefinition(visibleState ?? null, charmDetail) && <Modal title={`${charmDefinition(visibleState ?? null, charmDetail).name}${visibleState && isCampaign(visibleState) ? ` ${['Ⅰ', 'Ⅱ', 'Ⅲ'][charmTier(visibleState.charms.find(charm => charm?.definitionId === charmDetail) ?? { id: '', definitionId: charmDetail, acquiredPrice: 0 }) - 1]}` : ''}`} close={() => setCharmDetail(null)}><p className="v2-eyebrow">常驻锦囊 · 按槽位从左到右结算</p><p className="v2-rule-text">{charmDefinition(visibleState ?? null, charmDetail, inspectedCharm ? charmTier(inspectedCharm) : 1).text}</p>{visibleState && isCampaign(visibleState) && <p>增幅＋N 为加法积累，增幅×N 放大此前增幅；先加后乘与先乘后加结果不同。升阶替换原效果，不叠加旧阶数。</p>}<p>锦囊不会消耗，不进入手牌。可用左右箭头调整三个槽位的顺序。</p>{visibleState?.phase === 'battle' && visibleState.charms.map((item, index) => item?.definitionId === charmDetail && <div key={index} className="v2-charm-detail-order"><button disabled={index === 0} onClick={() => view === 'tutorial' ? tutorial.dispatch({ type: 'action', action: { type: 'moveCharm', from: index, to: index - 1 } }) : send({ type: 'moveCharm', from: index, to: index - 1 })}>锦囊左移</button><button disabled={index === 2} onClick={() => view === 'tutorial' ? tutorial.dispatch({ type: 'action', action: { type: 'moveCharm', from: index, to: index + 1 } }) : send({ type: 'moveCharm', from: index, to: index + 1 })}>锦囊右移</button></div>)}</Modal>}
    {deckOpen && state && <Modal title={`本局牌库 · ${state.owned.filter(id => !state.removed.includes(id)).length} 张`} close={() => setDeckOpen(false)} wide><p>同名牌分别成长。金色“先锋”标记表示每战都会出现在起手中。</p><OwnedCards state={state} onChoose={id => { setDeckOpen(false); inspect(id); }} /><details><summary>最近军资与事件记录</summary>{state.log.slice(-30).reverse().map(item => <p key={item.id}>{item.text} {item.goldDelta ? `（${item.goldDelta > 0 ? '+' : ''}${item.goldDelta} 金）` : ''}</p>)}</details></Modal>}
    {replacePending && <Modal title="开启全新远征" close={() => setReplacePending(null)}><p>当前远征的存档会被这次新局替换。需要保留时，可先在设置导出备份。</p><button className="v2-primary" onClick={() => { const args = replacePending; setReplacePending(null); start(...args); }}>确认替换，启程</button><button onClick={() => setReplacePending(null)}>保留当前远征</button></Modal>}
    {exitOpen && <Modal title="暂别战场" close={() => setExitOpen(false)}><p>所有已完成操作都已自动保存，可随时从主菜单继续。</p><button className="v2-primary" onClick={() => { setExitOpen(false); setView('menu'); }}>返回主菜单</button><button onClick={() => setExitOpen(false)}>继续布阵</button></Modal>}
    {conflict && <Modal title="远征已在其他页面更新" close={() => setConflict(false)}><p>为保护另一页面的进度，本次操作没有写入。请读取最新存档后继续。</p><button className="v2-primary" onClick={() => { const latest = savedRun(); if (latest.state) { setState(latest.state); setLoadEpoch(epoch => epoch + 1); baseline.current = latest.raw; setConflict(false); setNotice('已读取最新进度。'); } else { setError(latest.error || '最新存档不存在，请先导出本页进度再开始新局。'); setConflict(false); } }}>读取最新进度</button><button onClick={() => { setConflict(false); setPreviousView('game'); setView('settings'); }}>导出本页进度</button></Modal>}
  </div>{welcomeOpen && <Modal title="是否进入新手教程？" close={() => answerWelcome(false)}><p>跟着高亮位置点选、布阵和出战，用两场演武学会破阵。每次操作旁都会有解释，约需 5 分钟。</p><p>你也可以先进入游戏，之后从主菜单“新手演武”开始学习。</p>{welcomeError && <p role="alert">{welcomeError}</p>}<button className="v2-primary" onClick={() => answerWelcome(true)}>进入新手教程</button><button onClick={() => answerWelcome(false)}>暂时跳过，直接游戏</button></Modal>}<BreakImpact event={impact} clear={() => setImpact(null)} /></div></CardInspector>;
}
