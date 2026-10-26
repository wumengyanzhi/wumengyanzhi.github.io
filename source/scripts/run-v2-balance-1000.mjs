import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { writeEconomyComparison } from './balance-economy-report.mjs';

const DATE = '2026-10-23';
const TOTAL = 1000;
const BUILD_AWARE = process.env.BALANCE_ECONOMY === 'build-aware';
const BASELINE = `artifacts/v2/${DATE}-balance-1000`;
const OUTPUT = BASELINE + (BUILD_AWARE ? '-economy' : '');
const POLICIES = ['matching', 'growth'];
const LABELS = { matching: '配装即时伤害', growth: '成长与主动弃牌' };
const hash = value => createHash('sha256').update(value).digest('hex');
const pct = value => value === null ? '无样本' : `${(value * 100).toFixed(1)}%`;
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const median = xs => {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const stageName = index => `${Math.floor(index / 6) + 1}-${index % 6 + 1}`;
const engineServer = () => createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: 'custom', logLevel: 'error',
});
function wilson(wins, total) {
  if (!total) return null;
  const z = 1.959963984540054, p = wins / total, d = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / d;
  const radius = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}
function summarize(rows, enemies) {
  const normal = rows.filter(r => r.status === 'completed');
  const wins = normal.filter(r => r.phase === 'won').length;
  return {
    total: rows.length, completed: normal.length, wins, losses: normal.length - wins,
    errors: rows.filter(r => r.status === 'error').length,
    budgets: rows.filter(r => r.status === 'budget_exceeded').length,
    winRate: normal.length ? wins / normal.length : null,
    stages: enemies.map((enemy, index) => {
      const reached = normal.flatMap(r => r.battles.filter(b => b.index === index));
      const won = reached.filter(b => b.won), lost = reached.filter(b => !b.won);
      const reports = reached.flatMap(b => b.reports);
      return {
        index, stage: stageName(index), name: enemy.name, kind: enemy.kind, hp: enemy.hp,
        reached: reached.length, won: won.length, lost: lost.length,
        reachRate: normal.length ? reached.length / normal.length : null,
        conditional: reached.length ? won.length / reached.length : null,
        cumulative: normal.length ? won.length / normal.length : null,
        medianWinPlays: median(won.map(b => b.plays)),
        averageDiscards: mean(reached.map(b => b.discards)),
        averagePower: mean(reports.map(b => b.power)), averageAmp: mean(reports.map(b => b.amp)),
        medianDamage: median(reports.map(b => b.damage)),
        medianLossRemainingHp: median(lost.map(b => b.remainingHp)),
        medianLossHpFraction: median(lost.map(b => b.remainingHp / enemy.hp)),
        nearMisses: lost.filter(b => b.remainingHp <= enemy.hp * 0.1).length,
      };
    }),
  };
}
async function sourceSnapshot() {
  const files = ['package.json', 'package-lock.json', 'scripts/run-v2-balance-1000.mjs', 'scripts/balance-economy-report.mjs'];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = `${dir}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== 'ui') await walk(name);
      else if (entry.isFile() && name.endsWith('.ts')) files.push(name);
    }
  }
  await walk('src/v2');
  const sources = await Promise.all(files.sort().map(async name => {
    const text = await fs.readFile(name, 'utf8');
    return { path: name, sha256: hash(text), text };
  }));
  return { fingerprint: hash(JSON.stringify(sources.map(({ path: name, sha256 }) => [name, sha256]))), sources };
}

if (!isMainThread) {
  const server = await engineServer();
  try {
    const { simulateRun } = await server.ssrLoadModule('/src/v2/simulation.ts');
    const { serializeRun, parseRun } = await server.ssrLoadModule('/src/v2/persistence.ts');
    for (const sample of workerData.samples) {
      const started = performance.now();
      const result = simulateRun(sample);
      // Every terminal state must be accepted by the production save validator.
      if (result.status === 'completed') assert.deepEqual(parseRun(serializeRun(result.state)), result.state);
      parentPort.postMessage({ sampleIndex: sample.sampleIndex, elapsedMs: performance.now() - started, result });
    }
  } finally { await server.close(); }
} else {
  const started = new Date(), elapsedStart = performance.now();
  const server = await engineServer();
  try {
    const { DECKS, ENEMIES, CARD_MAP } = await server.ssrLoadModule('/src/v2/data.ts');
    const { CONTENT_VERSION, createRun, act } = await server.ssrLoadModule('/src/v2/engine.ts');
    const { serializeRun, parseRun } = await server.ssrLoadModule('/src/v2/persistence.ts');
    const economyPolicy = await server.ssrLoadModule('/src/v2/simulation-economy.ts');
    const cells = DECKS.flatMap(deck => POLICIES.map(policy => ({ deckId: deck.id, deckName: deck.name, policy, policyName: LABELS[policy], leaderDefinitionId: deck.leaders[policy === 'growth' ? 0 : 1] })));
    assert.equal(cells.length, 6);
    assert.equal(ENEMIES.length, 18);
    const baselineManifest=BUILD_AWARE?JSON.parse(await fs.readFile(`${BASELINE}/manifest.json`,'utf8')):null;
    const samples = baselineManifest ? baselineManifest.samples.map(s=>({...s,economy:'build-aware'})) : Array.from({ length: TOTAL }, (_, index) => ({
      sampleIndex: index, ...cells[index % cells.length], difficulty: 'standard',
      seed: `balance-${DATE}-1000:${String(index + 1).padStart(4, '0')}`,
    }));
    assert.equal(new Set(samples.map(s => s.seed)).size, TOTAL);
    await fs.mkdir(OUTPUT, { recursive: true });
    const snapshot = await sourceSnapshot();
    if(BUILD_AWARE){
      const old=JSON.parse(await fs.readFile(`${BASELINE}/sources.json`,'utf8'));
      for(const source of old.sources.filter(x=>x.path.startsWith('src/v2/')&&x.path!=='src/v2/simulation.ts')){
        assert.equal(snapshot.sources.find(x=>x.path===source.path)?.sha256,source.sha256,`Game rules changed: ${source.path}`);
      }
    }
    await fs.writeFile(`${OUTPUT}/sources.json`, JSON.stringify(snapshot));
    const manifest = {
      date: DATE, startedAt: started.toISOString(), sourceFingerprint: snapshot.fingerprint,
      contentVersion: CONTENT_VERSION, node: process.version, total: TOTAL,
      economy:BUILD_AWARE?{version:economyPolicy.ECONOMY_POLICY_VERSION,limits:economyPolicy.ECONOMY_LIMITS,baseline:BASELINE,gameRulesMatchBaseline:true}:null,
      design: '1000 distinct predeclared game seeds; round-robin 6 deck/policy cells; standard difficulty; actual engine; no state boosts',
      cells: cells.map(cell => ({ ...cell, planned: samples.filter(s => s.deckId === cell.deckId && s.policy === cell.policy).length })),
      enemyHp: ENEMIES.map(e => e.hp), samples,
      limitations: BUILD_AWARE?[
        'Battle search, discard policy and starter leader unchanged from baseline; economy decisions alone changed.',
        'Heuristic historical-use estimates, not an optimal or human policy; no future RNG, draw order or unseen offers.',
        'Enhancement rerolls capped at 2 per reward; market rerolls capped at 1 per visit; no battle multi-play lookahead.',
      ]:[
        'Limited visible-hand formation templates, not exhaustive search or human play.',
        'Policy also selects a different starter leader, so policy groups are not a controlled pure-policy comparison.',
        'No paid enhancement rerolls, market rerolls, voluntary removals, charm-order optimization, or multi-play lookahead.',
        'Greedy reward selection does not estimate full build synergy; equal-group aggregate is not population win rate.',
      ],
    };
    await fs.writeFile(`${OUTPUT}/manifest.json`, JSON.stringify(manifest, null, 2));
    const raw = await fs.open(`${OUTPUT}/runs.ndjson`, 'w');
    const rows = [], replayCandidates = new Map();
    let writes = Promise.resolve(), done = 0;
    try {
      await Promise.all(Array.from({ length: 3 }, (_, workerIndex) => new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { samples: samples.filter((_, i) => Math.floor(i / cells.length) % 3 === workerIndex) } });
        worker.on('message', record => {
          const { result: r, sampleIndex, elapsedMs } = record;
          writes = writes.then(() => raw.write(`${JSON.stringify(record)}\n`));
          const state = r.state;
          const row = { sampleIndex, seed: r.seed, deckId: r.deckId, policy: r.policy, status: r.status, error: r.error,
            phase: state.phase, battleIndex: state.battleIndex, gold: state.gold, baseAmp: state.baseAmp ?? 0,
            commands: r.commands.length, elapsedMs, battles: state.battles,
            actionCounts: Object.fromEntries([...new Set(r.commands.map(c => c.type))].map(type => [type, r.commands.filter(c => c.type === type).length])),
            spending: state.log.filter(l => l.goldDelta < 0), charms: state.charms,
          };
          rows.push(row);
          const key = `${r.deckId}/${r.policy}`, candidates = replayCandidates.get(key) ?? [];
          // Save first sample and deepest sample per group for complete command replay.
          if (!candidates.length) candidates.push(record);
          if (candidates.length === 1) candidates.push(record);
          else if (state.battles.length > candidates[1].result.state.battles.length) candidates[1] = record;
          replayCandidates.set(key, candidates);
          done++;
          if (done % 25 === 0 || done === TOTAL) console.log(JSON.stringify({ completed: done, total: TOTAL, elapsedSeconds: Math.round((performance.now() - elapsedStart) / 1000), wins: rows.filter(x => x.phase === 'won').length, maxStage: stageName(Math.max(...rows.map(x => x.battleIndex))) }));
        });
        worker.on('error', reject);
        worker.on('exit', code => code === 0 ? resolve() : reject(new Error(`Simulation worker exited ${code}`)));
      })));
      await writes;
    } finally { await raw.close(); }
    rows.sort((a, b) => a.sampleIndex - b.sampleIndex);
    assert.equal(rows.length, TOTAL);
    assert.equal(new Set(rows.map(r => r.seed)).size, TOTAL);
    const current = await sourceSnapshot();
    assert.equal(current.fingerprint, snapshot.fingerprint, 'Runtime sources changed during experiment');
    const summary = summarize(rows, ENEMIES);
    const groups = cells.map(cell => {
      const subset = rows.filter(r => r.deckId === cell.deckId && r.policy === cell.policy);
      const s = summarize(subset, ENEMIES);
      return { ...cell, leaderName: CARD_MAP[cell.leaderDefinitionId].name, ...s, wilson95: wilson(s.wins, s.completed) };
    });
    const replayed = [];
    for (const record of new Map([...replayCandidates.values()].flat().map(r => [r.sampleIndex, r])).values()) {
      const r = record.result, sample = samples[record.sampleIndex];
      let state = createRun(sample.deckId, sample.leaderDefinitionId, sample.seed, 'standard');
      for (const [index, command] of r.commands.entries()) {
        const next = act(state, command, `auto-${index}`);
        assert.equal(next.ok, true, `Replay ${sample.seed}/${index}: ${next.error}`);
        state = parseRun(serializeRun(next.state));
      }
      assert.deepEqual(state, r.state);
      replayed.push({ sampleIndex: record.sampleIndex, seed: r.seed, deckId: r.deckId, policy: r.policy, commands: r.commands.length, stateHash: hash(JSON.stringify(state)), savedEveryCommand: true });
    }
    for (const r of rows.filter(row => row.status === 'completed')) {
      assert.ok(['won', 'lost'].includes(r.phase));
      assert.equal(r.battles.length, r.battleIndex + 1);
      r.battles.forEach((b, i) => {
        assert.equal(b.index, i);
        assert.equal(b.enemyId, ENEMIES[i].id);
        assert.equal(b.won, i < r.battles.length - 1 || r.phase === 'won');
        assert.equal(b.remainingHp, ENEMIES[i].hp - b.reports.reduce((sum, p) => sum + p.actualDamage, 0));
        assert.equal(b.plays, b.reports.length);
        for (const p of b.reports) {
          assert.equal(p.damage, p.power * p.amp);
          assert.equal(p.damage, p.actualDamage + p.overflow);
        }
      });
    }
    assert.equal(summary.stages[0].reached, summary.completed);
    for (let i = 1; i < 18; i++) assert.equal(summary.stages[i].reached, summary.stages[i - 1].won);
    assert.equal(summary.stages.reduce((n, s) => n + s.lost, 0) + summary.wins, summary.completed);
    const equalCellWinRate = groups.every(g => g.completed > 0) ? mean(groups.map(g => g.winRate)) : null;
    const output = { manifest: `${OUTPUT}/manifest.json`, sourceFingerprint: snapshot.fingerprint,
      finishedAt: new Date().toISOString(), elapsedSeconds: (performance.now() - elapsedStart) / 1000,
      summary, groups, equalCellWinRate, replayed, rows,
      validation: { uniqueSeeds: TOTAL, validTerminalSaves: summary.completed, commandReplays: replayed.length, sourceUnchanged: true, stageFlowAndDamageAudit: true },
    };
    await fs.writeFile(`${OUTPUT}/summary.json`, JSON.stringify(output, null, 2));
    const csv = ['sample,seed,deck,policy,status,result,last_stage,gold,base_amp,commands', ...rows.map(r => [r.sampleIndex + 1, r.seed, r.deckId, r.policy, r.status, r.phase, stageName(r.battleIndex), r.gold, r.baseAmp, r.commands].join(','))];
    await fs.writeFile(`${OUTPUT}/runs.csv`, '\uFEFF' + csv.join('\n'));
    const lines = [
      '# 当前数值1000局自动演练', '',
      `日期：${DATE}。标准难度，当前三关十八局与随机三选一强化规则。共1000个预先固定且不重复的游戏种子，六组各166或167局。运行未调整卡牌、血量或奖励。`, '',
      `计划1000局；正常结束${summary.completed}局，通关${summary.wins}局，战败${summary.losses}局，执行错误${summary.errors}局，预算超限${summary.budgets}局。样本合计通关率${pct(summary.winRate)}；六组等权通关率${pct(equalCellWinRate)}。`, '',
      '自动策略只能代表本次打法，不能当作真人通关率。两种打法使用不同先锋，分组比较包含先锋差异。总样本按固定近等权分配，不代表玩家真实选牌组与打法比例。', '',
      '## 分组结果', '',
      '| 起手 | 打法 | 先锋 | 正常局数 | 通关 | 通关率 | 95% Wilson区间 |',
      '|---|---|---|---:|---:|---:|---|',
      ...groups.map(g => `| ${g.deckName} | ${g.policyName} | ${g.leaderName} | ${g.completed} | ${g.wins} | ${pct(g.winRate)} | ${g.wilson95 ? g.wilson95.map(pct).join('–') : '无样本'} |`), '',
      'Wilson区间仅描述各固定打法在种子抽样下的不确定性，不包含自动策略偏差。总汇总不套用单一分组的Wilson区间。', '',
      '## 逐关漏斗', '',
      '到达后通过率＝该关胜局÷到达局；累计通过率＝该关胜局÷正常结束总局数。失败余血以在该关战败的样本计中位数。', '',
      '| 关卡 | 类型 | 血量 | 到达 | 通过 | 失败 | 到达后通过率 | 累计通过率 | 失败余血中位数 |',
      '|---|---|---:|---:|---:|---:|---:|---:|---:|',
      ...summary.stages.map(s => `| ${s.stage} ${s.name} | ${s.kind === 'boss' ? 'Boss' : '普通'} | ${s.hp} | ${s.reached} | ${s.won} | ${s.lost} | ${pct(s.conditional)} | ${pct(s.cumulative)} | ${s.medianLossRemainingHp ?? '无样本'} |`), '',
      '## 打法和局限', '',
      '- 配装即时伤害：从固定阵型模板中挑选当前伤害高的布阵，自动选装备与技能目标；通常不主动弃牌，获得折箭令后每场主动弃牌两次。',
      '- 成长与主动弃牌：同样使用有限布阵搜索，每场先弃一次低评分牌，并为特定成长技能略加评分；折箭令路线弃两次。',
      BUILD_AWARE?'- 战后结合既有永久数值、先锋职业匹配与历史出场选择招募/替换及强化；对照原有战斗与弃牌策略不变。':'- 战后按稀有度与静态数值招募，优先选增幅强化；按固定优先级购买/升阶锦囊与增幅锻造。',
      BUILD_AWARE?'- 本轮已按构筑选择强化与招募，比较可负担锦囊购买/换购、升阶和锻造；强化重抽每奖励最多2次、军市刷新每店最多1次，保留近期商店预算，资金充足时删除低价值未强化普通牌，加法锦囊置于乘法锦囊之前。仍是启发式策略，不能视为最优解。':'- 两种打法都不使用付费强化重抽、军市刷新、主动删牌、锦囊顺序优化或多手规划；不能视为熟练玩家或最优解。',
      '- 低通过率只说明这些固定打法在当前数值下困难；血量、成长供给、抽牌稳定性和策略不足各自的影响，需要额外对照实验区分。', '',
      '## 可追查记录', '',
      `- 数据目录：\`${OUTPUT}/\`。manifest.json保存预先固定的1000组种子与分组。`,
      '- runs.ndjson保存每局全部命令、完整终局、逐手来源及金币账本；runs.csv便于逐局筛选；summary.json保存分组/逐关统计。',
      '- sources.json保存本次运行核心规则和数据的源码快照及SHA-256；前后指纹一致。',
      `- ${summary.completed}份正常终局通过实际存档校验；${replayed.length}局按命令完整回放，每一步存档导出再导入，最终状态一致。全部正常局核对关卡连贯性、血量减少、威力×增幅、溢出伤害与胜负分母。`,
      `- 执行时间${output.elapsedSeconds.toFixed(1)}秒仅为机器模拟时间，不能换算真人游玩时长。`,
    ];
    const report = `docs/完整游戏/${DATE}-1000局数值实测${BUILD_AWARE?'-购买成长对照':''}.md`;
    await fs.writeFile(report, lines.join('\n'));
    if(BUILD_AWARE)await writeEconomyComparison({output:OUTPUT,baseline:BASELINE,report,summary:output});
    console.log(JSON.stringify({ report, summary, groups: groups.map(g => Object.fromEntries(Object.entries(g).filter(([key]) => key !== 'stages'))), validation: output.validation, elapsedSeconds: output.elapsedSeconds }, null, 2));
    if (summary.completed !== TOTAL || summary.errors || summary.budgets) process.exitCode = 1;
  } finally { await server.close(); }
}
