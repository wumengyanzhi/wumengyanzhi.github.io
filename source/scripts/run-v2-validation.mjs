import fs from 'node:fs/promises';
import { createServer } from 'vite';
const date = process.env.VALIDATION_DATE ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid validation date');
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { simulateRun, summarizeRuns } = await server.ssrLoadModule('/src/v2/simulation.ts');
  const { DECKS } = await server.ssrLoadModule('/src/v2/data.ts');
  const { act, createRun } = await server.ssrLoadModule('/src/v2/engine.ts');
  const { serializeRun, parseRun } = await server.ssrLoadModule('/src/v2/persistence.ts');
  const results = [];
  const replayed = [];
  for (const deck of DECKS) for (const policy of ['matching', 'growth']) {
    for (let i = 0; i < 10; i++) {
      const result = simulateRun({ deckId: deck.id, policy, seed: `campaign-independent-20261020:${i}` });
      if (result.status === 'completed' && i === 0) {
        let state = createRun(deck.id, deck.leaders[policy === 'growth' ? 0 : 1], result.seed);
        for (const [index, command] of result.commands.entries()) {
          const next = act(state, command, `auto-${index}`);
          if (!next.ok) throw new Error(`Replay ${deck.name}/${policy}: ${next.error}`);
          state = parseRun(serializeRun(next.state));
        }
        if (JSON.stringify(state) !== JSON.stringify(result.state)) throw new Error('Replay state mismatch');
        replayed.push({ deck: deck.id, policy, commands: result.commands.length, savedEveryCommand: true });
      }
      results.push(result);
    }
    console.log(JSON.stringify({ deck: deck.name, policy, ...summarizeRuns(results.filter(r => r.deckId === deck.id && r.policy === policy)) }));
  }
  const summary = summarizeRuns(results);
  const output = { version: 1, ruleset: 'mobile_v2', source: 'V2 actual engine, 10 fixed seeds x 3 decks x 2 limited public-state policies', summary, replayed, results };
  await fs.mkdir('artifacts/v2', { recursive: true });
  await fs.writeFile(`artifacts/v2/${date}-validation.json`, JSON.stringify(output));
  const lines = ['# 十八局真实引擎验证', '', `日期：${date}。10 个固定种子 × 三套起手 × 两种公开手牌策略。自动策略有明确搜索限制，结果不代表真人乐趣或通关率。`, '', `计划 60 局；正常完成 ${summary.completed}，胜 ${summary.wins}，负 ${summary.losses}，错误 ${summary.errors}，预算超限 ${summary.budgets}。`, '', '| 牌组 | 策略 | 正常 | 胜 | 负 |', '|---|---|---:|---:|---:|'];
  for (const deck of DECKS) for (const policy of ['matching', 'growth']) { const s = summarizeRuns(results.filter(r => r.deckId === deck.id && r.policy === policy)); lines.push(`| ${deck.name} | ${policy} | ${s.completed} | ${s.wins} | ${s.losses} |`); }
  lines.push('', `从开局完整回放 ${replayed.length} 局；每条提交命令后均执行存档导出、校验导入，再推进下一命令。最终状态与原模拟深度一致。`, '', `完整每局状态、命令序列、逐手伤害、来源及金币账本保存在 artifacts/v2/${date}-validation.json。未通过真人试玩、真机性能或局长验收。`);
  await fs.mkdir('docs/完整游戏', { recursive: true });
  await fs.writeFile(`docs/完整游戏/${date}-自动演练.md`, lines.join('\n'));
  console.log(JSON.stringify({ summary, replayed: replayed.length }));
  if (summary.errors || summary.budgets || summary.completed !== 60) process.exitCode = 1;
} finally { await server.close(); }
