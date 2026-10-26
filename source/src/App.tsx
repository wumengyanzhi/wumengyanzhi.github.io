import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { createGameController, type GameCommand, type GameController } from '@app/game-controller';
import { createConfigRegistry, type ConfigRegistry } from '@config/config-registry';
import { applyRuntimePatch, type RuntimePatch } from '@config/runtime-patch';
import type { EnhancementCandidate } from '@domain/state/game-state';
import { createSeededRng } from '@infra/rng/seeded-rng';
import { createLocalStorageSaveRepository } from '@infra/storage/local-storage-save-repository';
import { useEventAnimation } from '@ui/animation/use-event-animation';
import { Dialog } from '@ui/battle/choice-dialog';
import { BattleScreen } from '@ui/battle/battle-screen';
import { EnemyPanel } from '@ui/battle/enemy-panel';
import { ResourceBar } from '@ui/battle/resource-bar';
import { MainMenu } from '@ui/screens/main-menu';
import { ResultScreen } from '@ui/screens/result-screen';
import { RewardScreen } from '@ui/screens/reward-screen';
import { RunMap } from '@ui/screens/run-map';
import { useUiState } from '@ui/state/ui-store';
import '@ui/styles/index.css';

const loaded = createConfigRegistry();
if (!loaded.ok) throw new Error('游戏配置无效，无法启动');
const defaultRegistry = loaded.value;
const defaultController = createGameController({
  registry: defaultRegistry,
  storage: createLocalStorageSaveRepository(),
  rng: createSeededRng(),
});

/**
 * 开发期调参面板。
 *
 * 走动态导入，并且只在 `import.meta.env.DEV` 下才引用：生产构建时这个表达式被替换成 false，
 * 整支连同动态 import 一起被摇掉，dist 里既没有面板代码，也不会有它的 chunk。
 */
const TuningPanel = import.meta.env.DEV ? lazy(() => import('@ui/debug/patch-panel')) : null;

interface AppProps {
  readonly controller?: GameController;
  readonly registry?: ConfigRegistry;
  /** 开局种子来源。默认用随机 UUID；界面测试注入固定序列，否则手牌组成随机、断言无法稳定。 */
  readonly runSeed?: () => string;
}

/**
 * 应用外壳。
 *
 * 这里只做三件事：把 GameState 交给对应的幕、把玩家点击翻译成命令、把领域回话翻译成提示。
 * 任何数值都不过这一层——它们已经在 selectors 里算好了。
 */
export function App({
  controller = defaultController,
  registry = defaultRegistry,
  runSeed,
}: AppProps): ReactElement {
  const [state, setState] = useState(controller.state);
  const [menuOpen, setMenuOpen] = useState(controller.state === null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [tunerOpen, setTunerOpen] = useState(false);
  // 换配置不会换 GameState，订阅者拿到的还是同一个对象，React 会跳过重渲染；
  // 这个计数专门用来把界面重新拉起来读一遍新的 selectors。
  const [, bumpConfig] = useState(0);
  const { ui, actions } = useUiState();
  const animation = useEventAnimation({ enabled: ui.animationsEnabled });
  // 事件播放在 dispatch 之后接手：命令已经提交，动画只是把这一手怎么发生的演一遍。
  const animationRef = useRef(animation);
  animationRef.current = animation;

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    if (controller.state === null) {
      const resumed = controller.resume();
      if (resumed.ok) setMenuOpen(false);
    }
    return unsubscribe;
  }, [controller]);

  const dispatch = useCallback((command: GameCommand): boolean => {
    const result = controller.dispatch(command);
    if (!result.ok) {
      actions.setNotice({ kind: 'error', text: result.error.message });
      return false;
    }
    const damage = result.value.events.find((event) => event.type === 'DamageResolved');
    if (damage?.type === 'DamageResolved') actions.reportDamage(damage.amount);
    animationRef.current.play(result.value.events);
    const saveError = result.value.saveError;
    actions.setNotice(
      saveError === undefined
        ? null
        : { kind: 'error', text: `自动存档失败，请立即导出存档：${saveError.message}` },
    );
    return true;
  }, [controller, actions]);

  const reward = state?.pendingChoice?.kind === 'enhancement_reward' ? state.pendingChoice : null;
  const run = registry.getRunDefinition(state?.run.runDefinitionId ?? '');
  const totalBattles = run === undefined ? 3 : run.nodes.filter((node) => node.type === 'battle').length;
  const stages = useMemo(
    () => (run === undefined
      ? []
      : run.nodes.filter((node) => node.type === 'battle').map((node) => {
        const enemy = registry.getEnemyDefinition(node.contentRef);
        return {
          name: enemy?.name ?? '敌军',
          label: enemy?.type === 'elite' ? '精英' : enemy?.type === 'boss' ? '首领' : '前锋',
        };
      })),
    [run, registry],
  );
  const battle = state?.battle ?? null;
  const finished = state !== null && state.run.status !== 'running';
  const stalledEnemyName = battle === null
    ? (stages[Math.min(state?.run.battlesWon ?? 0, stages.length - 1)]?.name ?? null)
    : null;

  function startRun(): void {
    const seed = runSeed?.() ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
    if (!dispatch({ type: 'NewRun', seed })) return;
    actions.reset();
    setMenuOpen(false);
  }

  /** 调参面板的落点：基础配置 + 补丁合成一份新配置交给控制器，基础配置文件不动。 */
  function applyPatch(patch: RuntimePatch): void {
    const applied = applyRuntimePatch(registry.config, patch);
    if (!applied.ok) {
      actions.setNotice({ kind: 'error', text: applied.error[0]?.message ?? '调参补丁被拒绝' });
      return;
    }
    controller.setConfig(applied.value);
    bumpConfig((tick) => tick + 1);
  }

  function exportSave(): void {
    const exported = controller.exportSave();
    if (!exported.ok) {
      actions.setNotice({ kind: 'error', text: exported.error.message });
      return;
    }
    const url = URL.createObjectURL(new Blob([exported.value.content], { type: exported.value.contentType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = exported.value.filename;
    link.click();
    URL.revokeObjectURL(url);
    actions.setNotice({ kind: 'info', text: `存档已导出：${exported.value.filename}` });
  }

  async function importSave(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    try {
      const imported = controller.importSave(await file.text());
      if (!imported.ok) {
        actions.setNotice({ kind: 'error', text: imported.error.message });
        return;
      }
      actions.reset();
      setMenuOpen(false);
      actions.setNotice({ kind: 'info', text: '存档导入成功，原自动存档已备份。' });
    } catch {
      actions.setNotice({ kind: 'error', text: '无法读取存档文件，当前进度未改变。' });
    }
  }

  const shellClass = ui.animationsEnabled ? 'app-shell' : 'app-shell app-shell--no-anim';
  const animAttr = animation.marks.length > 0 ? animation.marks.join(' ') : undefined;

  if (state === null || menuOpen) {
    return (
      <main className={shellClass} data-anim={animAttr}>
        <MainMenu
          canResume={state !== null}
          canReturn={state !== null}
          animationsEnabled={ui.animationsEnabled}
          notice={ui.notice}
          onStart={() => {
            if (state !== null && state.run.status === 'running' && reward === null) {
              setConfirmRestart(true);
              return;
            }
            startRun();
          }}
          onResume={() => {
            const resumed = controller.resume();
            if (!resumed.ok) {
              actions.setNotice({ kind: 'error', text: resumed.error.message });
              return;
            }
            setMenuOpen(false);
          }}
          onReturn={() => setMenuOpen(false)}
          onExport={exportSave}
          onImport={(file) => { void importSave(file); }}
          onToggleAnimations={actions.setAnimationsEnabled}
        />

        {confirmRestart && (
          <Dialog
            title="重开一局？"
            subtitle="新的冒险会覆盖当前自动存档，这一局的强化与进度都不会保留。"
            narrow
            onClose={() => setConfirmRestart(false)}
            footer={
              <div className="reward-actions">
                <button type="button" className="btn btn--danger" onClick={() => {
                  setConfirmRestart(false);
                  startRun();
                }}
                >
                  确认重开
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmRestart(false)}>
                  再想想
                </button>
              </div>
            }
          >
            <p className="preview__empty">只是想回到刚才那一局？点「再想想」，再点主菜单里的返回当前战局。</p>
          </Dialog>
        )}
      </main>
    );
  }

  const live = { state, registry, selectors: controller.selectors, ui, actions, dispatch };

  return (
    <main className={shellClass} data-anim={animAttr}>
      <>
        <header className="topbar">
            {run !== undefined && (
              <RunMap
                run={run}
                battlesWon={state.run.battlesWon}
                currentNodeId={state.run.currentNodeId}
                stages={stages}
                size="bar"
              />
            )}

            {battle === null ? (
              <div className="topbar__panel panel enemy-panel">
                <span className="panel-title">战 事</span>
                <strong className="enemy-panel__name">{finished ? '本局已终' : '整军待发'}</strong>
                <p className="field__hint">
                  {finished ? '返回菜单可导出存档或再开一局。' : '正在进入下一场，稍候。'}
                </p>
              </div>
            ) : (
              <EnemyPanel
                name={registry.getEnemyDefinition(battle.enemyDefinitionId)?.name ?? '敌军'}
                type={registry.getEnemyDefinition(battle.enemyDefinitionId)?.type ?? 'normal'}
                currentHp={battle.enemyCurrentHp}
                maxHp={battle.enemyMaxHp}
                previewAfterHp={
                  state.zones.playSlots.some((slot) => slot !== null && slot !== undefined)
                    ? (() => {
                      const preview = controller.previewDamage();
                      return preview.ok ? Math.max(0, preview.value.enemyHpAfter) : null;
                    })()
                    : null
                }
                lastDamage={ui.lastDamage}
                lastDamageToken={ui.lastDamageToken}
                animationsEnabled={ui.animationsEnabled}
              />
            )}

            <ResourceBar
              playRemaining={battle?.playCountRemaining ?? 0}
              playTotal={controller.selectors.rules.playCount}
              discardRemaining={battle?.discardCountRemaining ?? 0}
              discardTotal={controller.selectors.rules.discardCount}
              handSize={state.zones.hand.length}
              handLimit={controller.selectors.rules.handLimit}
              gold={state.run.gold}
              drawPile={state.zones.drawPile.length}
              moraleTotal={battle?.moraleTotal ?? 0}
              moralePowerPerPoint={controller.selectors.rules.moralePowerPerPoint}
            />
          </header>

          {ui.notice !== null && !menuOpen && (
            <p className={ui.notice.kind === 'error' ? 'notice notice--error' : 'notice'} role="status">
              {ui.notice.text}
            </p>
          )}

          {reward !== null && (
            <RewardScreen
              {...live}
              candidates={reward.candidates as readonly EnhancementCandidate[]}
              rerollsUsed={state.run.rerollsUsed}
              maxRerolls={registry.config.economy.maxRerollsPerStage}
              rerollCost={registry.config.economy.rerollCost}
              skillText={(skillId) =>
                registry.config.enhancement.legendarySkillPool.find((skill) => skill.id === skillId) ?? null
              }
            />
          )}

          {finished && reward === null && (
            <ResultScreen
              run={state.run}
              totalBattles={totalBattles}
              stalledEnemyName={stalledEnemyName}
              onRestart={startRun}
              onBackToMenu={() => setMenuOpen(true)}
              onExport={exportSave}
            />
          )}

          {!finished && reward === null && <BattleScreen {...live} />}

          {animation.playing && (
            <div className="anim-skip">
              <span className="anim-skip__label">
                {animation.label === null ? '动画播放中' : `正在播放：${animation.label}`}
              </span>
              <button type="button" className="btn btn--ghost" onClick={animation.skip}>
                跳过动画
              </button>
            </div>
          )}

          {TuningPanel !== null && (
            <>
              {/*
                样式写成内联：面板的 CSS 是随面板懒加载的，而这个按钮在面板打开之前就要显示，
                而且它是开发期才渲染的节点，内联样式也就不会进生产包。
                定位必须用 fixed 且靠内联压过外壳的 `.app-shell > * { position: relative }`。
              */}
              <button
                type="button"
                onClick={() => setTunerOpen(true)}
                style={{
                  position: 'fixed',
                  left: 12,
                  // 抬高一点，别压住底栏左侧的「剩余出战」计数。
                  bottom: 44,
                  zIndex: 70,
                  minHeight: 30,
                  padding: '0 12px',
                  borderRadius: 999,
                  border: '1px dashed oklch(60% 0.03 70)',
                  background: 'oklch(20% 0.02 55 / 0.92)',
                  color: 'oklch(83% 0.018 80)',
                  fontSize: 12,
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                }}
              >
                调参
              </button>
              {tunerOpen && (
                <Suspense fallback={null}>
                  <TuningPanel
                    baseConfig={registry.config}
                    onChange={applyPatch}
                    onClose={() => setTunerOpen(false)}
                  />
                </Suspense>
              )}
            </>
          )}
      </>
    </main>
  );
}
