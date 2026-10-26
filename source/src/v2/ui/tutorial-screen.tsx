import { useState } from 'react';
import type { GameAction } from '../model';
import { CARD_MAP } from '../data';
import { previewBattle } from '../battle';
import { tutorialCard, tutorialHealth } from '../tutorial';
import type { TutorialEvent, TutorialSession, TutorialStep } from '../tutorial';
import { BattleScreen } from './battle-screen';
import { RewardScreen } from './campaign-screens';
import { CardFace } from './primitives';
import { TutorialScreen as RulesScreen } from './menu-screens';
import type { Settings } from './menu-screens';
import { TutorialCoachmark } from './tutorial-coachmark';
import './tutorial.css';

const FIRST_STEPS: TutorialStep[] = ['select-character', 'place-character', 'select-weapon', 'place-weapon-gap', 'select-staged-weapon', 'move-weapon', 'compare', 'drag-weapon', 'select-tactic', 'place-tactic', 'damage', 'damage-read', 'play', 'reward', 'enhance', 'camp'];
const slot = (index: number) => `[data-v2-slot="${index}"]`;
const hand = (id: string) => `[data-testid="v2-hand-card"][data-drag-card-id="${id}"]`;
interface Props {
  session: TutorialSession | null; dispatch: (event: TutorialEvent) => boolean; restart: () => void; reload: () => void;
  error: string; epoch: number; settings: Settings; detail: (id: string) => void; charm: (id: string) => void;
  exit: () => void; expedition: () => void;
}
export function InteractiveTutorial({ session, dispatch, restart, reload, error, epoch, settings, detail, charm, exit, expedition }: Props) {
  const [rules, setRules] = useState(false);
  const step = session?.step ?? 'intro';
  const run = session?.run;
  const finished = step === 'complete' || step === 'skipped';
  const locked = !!session && !['intro', 'practice', 'complete', 'skipped'].includes(step);
  const battleActive = run?.phase === 'battle' && !finished && step !== 'intro';
  const character = session ? tutorialCard(session, 'character') : '';
  const weapon = session ? tutorialCard(session, 'weapon') : '';
  const tactic = session ? tutorialCard(session, 'tactic') : '';
  const discard = session && step.startsWith('practice-') ? tutorialCard(session, 'discard') : '';
  const preview = battleActive && run ? previewBattle(run) : null;
  const send = (action: GameAction, input: 'click' | 'drag' | 'keyboard' = 'click') => { dispatch({ type: 'action', action, input }); };
  const lessons: Partial<Record<TutorialStep, { title: string; text: string; selectors: string[] }>> = {
    'select-character': { title: '先选一张人物', text: '点击这张「蜀中猛士」。朱红类型栏代表人物，姓名旁标出职业；威力用朱红、增幅用青蓝显示。灰色边框和“普通”表示品质。', selectors: [hand(character)] },
    'place-character': { title: '让人物入阵', text: '人物已选中。点击高亮的第 2 格，把它放进阵型；一次最多可以布置五张牌。', selectors: [slot(1)] },
    'select-weapon': { title: '再选一张兵器', text: '点击「环首刀」。青绿类型栏代表兵器，名称旁标出兵器分类。紧邻人物后会自动配属；隔着空格时，只保留兵器自身的基础威力与增幅。', selectors: [hand(weapon)] },
    'place-weapon-gap': { title: '先把兵器隔开放', text: '点击第 4 格。这里和人物之间隔着一格，先观察未配属时的伤害。', selectors: [slot(3)] },
    'select-staged-weapon': { title: '选中阵中的兵器', text: '点击第 4 格里的「环首刀」，接下来试着把它移到人物旁边。', selectors: [slot(3)] },
    'move-weapon': { title: '移到人物旁边', text: '点击第 3 格。与第 2 格人物相邻后，兵器就会自动配属。换位不消耗出战次数。', selectors: [slot(2)] },
    compare: { title: '自动配属生效了', text: `伤害从 ${session?.gapDamage ?? 0} 提升到 ${preview?.report?.damage ?? 0}。兵器会自动配属给相邻人物；两侧都有人物时，职业加成更高的一侧优先，同分选择左侧。人物可以同时装备左右两件兵器。`, selectors: ['.v2-preview'] },
    'drag-weapon': { title: '再练一次拖动', text: '把第 3 格的兵器拖到第 1 格。电脑按住移动；手机按住后移动再松手。键盘可聚焦第 1 格后按 Enter。', selectors: [slot(2), slot(0)] },
    'select-tactic': { title: '认识战术牌', text: '点击「筹措军粮」。靛蓝类型栏代表战术，这张牌能增加增幅；蓝色边框表示稀有品质。牌面只显示技能名称，完整条件与效果可在详情中查看。', selectors: [hand(tactic)] },
    'place-tactic': { title: '加入一张战术', text: '点击第 4 格，把战术加入本次阵型。再看看威力与增幅如何改变伤害。', selectors: [slot(3)] },
    damage: { title: '查看伤害怎么算', text: '点击“结算明细”，查看人物、兵器、战术和其他加成分别带来了什么。', selectors: ['.v2-preview button'] },
    'damage-read': { title: '威力乘增幅，就是伤害', text: '这里列出了真实结算来源。阅读后点击明细右上角“关闭”，准备出战。', selectors: ['[role="dialog"]'] },
    play: { title: '出战，击破木阵', text: '现在点击“出战破阵”。每战有 4 次出战和 3 次弃牌；布阵、撤回和换位不消耗次数。', selectors: ['.v2-play'] },
    reward: { title: '首胜，选择一位传说', text: '金色边框代表传说。查看这三位名将，选择任意一位收入牌组；正式远征首胜同样会获得这份奖励。', selectors: ['.v2-reward-card'] },
    enhance: { title: '选择一次永久强化', text: '从这三项中选一项。强化只作用于对应的那张实体卡，之后每场战斗都会保留。', selectors: ['.v2-reward-card'] },
    camp: { title: '带着成长，再练一场', text: '新名将和强化都已保存。点击“开始自由练习”，接下来体验一次弃牌补牌。', selectors: ['.v2-training-camp .v2-primary'] },
    'practice-discard': { title: '体验弃牌补牌', text: '点击“弃牌”。每次可换掉 1–5 张不需要的手牌，并补回相同数量；已布阵的牌会保留。', selectors: ['[data-tutorial-action="discard-open"]'] },
    'practice-pick-discard': { title: '勾选一张手牌', text: '点击高亮的这张手牌，把它加入本次弃牌选择。这里只练习换掉一张。', selectors: [hand(discard)] },
    'practice-confirm-discard': { title: '确认弃一补一', text: '点击确认按钮，消耗一次弃牌机会，换入一张新牌。之后就可以自己组阵破阵了。', selectors: ['[data-tutorial-action="discard-confirm"]'] },
  };
  const lesson = lessons[step];
  const hint = preview?.error ? `当前需要调整：${preview.error}` : '让人物与兵器相邻，再加入战术。传说也已在手牌中；看好预计伤害后出战。';
  const selectedHand = step === 'place-character' ? character : step === 'place-weapon-gap' ? weapon : step === 'place-tactic' ? tactic : null;
  const selectedSlot = step === 'move-weapon' ? 3 : step === 'drag-weapon' ? 2 : null;
  const effectiveSettings = step === 'drag-weapon' ? { ...settings, dragEnabled: true } : settings;
  return <main className="v2-training" data-tutorial-step={step}>
    <div className="v2-training-toolbar"><span>新手演武 · {step.startsWith('practice') ? '第二场' : '独立进度'}</span><div>{!locked && <button onClick={() => setRules(value => !value)} aria-expanded={rules}>玩法速查</button>}{!locked && <button onClick={exit}>退出演武</button>}{!locked && !finished && session && <button onClick={() => dispatch({ type: 'skip' })}>跳过教学</button>}{locked && <button onClick={() => dispatch({ type: 'retry' })}>重试当前步骤</button>}</div></div>
    {error && <div className="v2-error" role="alert"><span>{error}</span><button onClick={reload}>读取最新教学进度</button></div>}
    {rules && !locked && <RulesScreen />}
    {(step === 'intro' || finished || !session) && <section className="v2-training-guide v2-training-welcome"><div className="v2-training-guide-copy"><p className="v2-eyebrow">五格入门 · 两场实操</p><h2>{step === 'complete' ? '演武告捷' : step === 'skipped' ? '教学已跳过' : '跟着提示，亲手破阵'}</h2><p className="v2-training-goal">{step === 'complete' ? '你已学会点击布阵、拖动换位、兵器配属和战后成长。' : step === 'skipped' ? '随时可以回来重新演武。' : '每次只操作高亮位置，旁边会解释原因。第一场逐步学习，第二场自己练习。'}</p>{session?.migrationNotice && <p className="v2-training-tip">{session.migrationNotice}</p>}</div><div className="v2-training-controls">{step === 'intro' && session && <button className="v2-primary" onClick={() => dispatch({ type: 'next' })}>开始演武</button>}{(finished || !session) && <><button className="v2-primary" onClick={expedition}>踏上正式征途</button><button onClick={restart}>重新演武</button></>}</div></section>}
    {step === 'practice' && <section className="v2-training-guide"><div className="v2-training-guide-copy"><p className="v2-eyebrow">第二场 · 自由练习</p><h2>试着自己破阵</h2><p className="v2-training-goal">用人物、相邻兵器和战术，击破 240 耐久的木阵。</p>{!!session?.hints && <p className="v2-training-hint">{hint}</p>}</div><div className="v2-training-controls"><button onClick={() => dispatch({ type: 'hint' })}>给我一点提示</button><button onClick={() => dispatch({ type: 'retry' })}>重练第二场</button></div></section>}
    {battleActive && run && session && <BattleScreen key={`${epoch}-${session.attempts}-${run.battleIndex}`} state={run} send={send} detail={detail} charm={charm} settings={effectiveSettings} teaching={{ health: tutorialHealth(session), locked, stepKey: step, selectedHand, selectedSlot, canPlay: step === 'play' || step === 'practice', canDiscard: step.startsWith('practice'), canDrag: step === 'drag-weapon' || step === 'practice', discardMode: ['practice-pick-discard', 'practice-confirm-discard'].includes(step), discardIds: step === 'practice-confirm-discard' ? [discard] : [], onSelect: (cardId, fromSlot) => dispatch({ type: 'select', cardId, fromSlot }), onDiscardOpen: locked ? () => dispatch({ type: 'discard-open' }) : undefined, onDiscardSelect: cardId => dispatch({ type: 'discard-select', cardId }), onBreakdown: () => { if (step === 'damage') dispatch({ type: 'breakdown' }); }, onBreakdownClose: () => { if (step === 'damage-read') dispatch({ type: 'close-breakdown' }); } }} />}
    {step === 'practice' && run?.phase === 'lost' && <section className="v2-route-page"><h3>再调整一次就好</h3><p>让兵器与人物紧邻，自动配属后再比较伤害预览。训练可以反复尝试。</p></section>}
    {run && ['reward', 'enhance'].includes(step) && <RewardScreen state={run} send={send} detail={detail} charm={charm} />}
    {step === 'camp' && run && <section className="v2-training-camp">{run.owned.at(-1) && <CardFace definition={CARD_MAP[run.cards[run.owned.at(-1)!]!.definitionId]!} instance={run.cards[run.owned.at(-1)!]} />}<div><h3>新将已入营，强化也会保留</h3><p>第二场保留五格、八张起手、4 次出战和 3 次弃牌。</p><button className="v2-primary" onClick={() => send({ type: 'nextBattle' })}>开始自由练习</button></div></section>}
    <p className="v2-training-save">教学进度独立自动保存 · 演武奖励仅用于练习</p>
    {locked && lesson && <TutorialCoachmark step={`${step}-${epoch}-${session?.attempts}`} title={lesson.title} text={lesson.text} selectors={lesson.selectors} progress={step.startsWith('practice') ? `第二场 · 弃牌教学 ${step === 'practice-discard' ? 1 : step === 'practice-pick-discard' ? 2 : 3} / 3` : `第一场 · ${FIRST_STEPS.indexOf(step) + 1} / ${FIRST_STEPS.length}`} allowSelectors={['.v2-training-toolbar', '.v2-topbar', '.v2-training .v2-error']} drag={step === 'drag-weapon'} onNext={step === 'compare' ? () => dispatch({ type: 'next' }) : undefined} nextLabel="知道了" onExit={exit} onSkip={() => dispatch({ type: 'skip' })} />}
  </main>;
}
