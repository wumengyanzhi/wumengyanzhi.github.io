import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const features = [
  { action:'buyCharm',name:'购买/换购锦囊',label:t=>t.startsWith('购买 ') },
  { action:'upgradeCharm',name:'锦囊升阶',label:t=>t==='锦囊升阶' },
  { action:'forge',name:'定向锻造',label:t=>t==='定向锻造' },
  { action:'rerollEnhancement',name:'强化付费重抽',label:t=>t==='重抽强化候选' },
  { action:'rerollMarket',name:'军市刷新',label:t=>t==='刷新军市' },
  { action:'removeCard',name:'军市删牌',label:t=>t==='军市删牌' },
];
const pct = n => n===null?'无样本':`${(n*100).toFixed(1)}%`;
function spending(rows) {
  return features.map(f=>{
    const used=rows.filter(r=>(r.actionCounts[f.action]??0)>0);
    const payments=rows.flatMap(r=>r.spending.filter(l=>f.label(l.text)));
    const commands=rows.reduce((n,r)=>n+(r.actionCounts[f.action]??0),0);
    assert.equal(commands,payments.length,`Paid command/ledger mismatch: ${f.action}`);
    return { action:f.action,name:f.name,runs:used.length,commands,gold:payments.reduce((n,p)=>n-p.goldDelta,0),
      byBattle:Array.from({length:18},(_,index)=>({index,commands:payments.filter(p=>p.battleIndex===index).length,gold:payments.filter(p=>p.battleIndex===index).reduce((n,p)=>n-p.goldDelta,0)})) };
  });
}
export async function writeEconomyComparison({output,baseline,report,summary:current}) {
  const previous=JSON.parse(await fs.readFile(`${baseline}/summary.json`,'utf8'));
  const manifest=JSON.parse(await fs.readFile(`${output}/manifest.json`,'utf8'));
  const oldManifest=JSON.parse(await fs.readFile(`${baseline}/manifest.json`,'utf8'));
  assert.equal(current.rows.length,1000);assert.equal(previous.rows.length,1000);
  assert.equal(new Set(current.rows.map(r=>r.sampleIndex)).size,1000);
  const before=new Map(previous.rows.map(r=>[r.sampleIndex,r]));
  const pairing={bothWin:0,oldWinNewLoss:0,oldLossNewWin:0,bothLoss:0,invalid:0};
  const pairs=current.rows.map(row=>{
    const old=before.get(row.sampleIndex);assert.ok(old);
    for(const key of ['seed','deckId','policy'])assert.equal(row[key],old[key]);
    assert.deepEqual(manifest.samples[row.sampleIndex].leaderDefinitionId,oldManifest.samples[row.sampleIndex].leaderDefinitionId);
    if(row.status!=='completed'||old.status!=='completed')pairing.invalid++;
    else {
      const oldWin=old.phase==='won',newWin=row.phase==='won';
      pairing[oldWin?(newWin?'bothWin':'oldWinNewLoss'):(newWin?'oldLossNewWin':'bothLoss')]++;
    }
    return {sampleIndex:row.sampleIndex,seed:row.seed,deckId:row.deckId,policy:row.policy,before:old.phase,after:row.phase,beforeStage:old.battleIndex,afterStage:row.battleIndex};
  });
  const currentSpending=spending(current.rows),previousSpending=spending(previous.rows);
  const groups=current.groups.map(g=>{
    const old=previous.groups.find(x=>x.deckId===g.deckId&&x.policy===g.policy);assert.ok(old);
    return {deck:g.deckName,policy:g.policyName,leader:g.leaderName,total:g.completed,oldWins:old.wins,newWins:g.wins,oldRate:old.winRate,newRate:g.winRate,difference:g.winRate-old.winRate};
  });
  // Independent re-count from complete raw records, not the summary arrays.
  const records=(await fs.readFile(`${output}/runs.ndjson`,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(records.length,1000);
  assert.equal(new Set(records.map(r=>r.result.seed)).size,1000);
  for(const stage of current.summary.stages){
    const battles=records.filter(r=>r.result.status==='completed').flatMap(r=>r.result.state.battles.filter(b=>b.index===stage.index));
    assert.equal(battles.length,stage.reached);assert.equal(battles.filter(b=>b.won).length,stage.won);
  }
  for(const record of records){
    const r=record.result;assert.equal(r.economy,'build-aware');
    const row=current.rows.find(x=>x.sampleIndex===record.sampleIndex);assert.ok(row);
    assert.equal(r.state.phase,row.phase);assert.equal(r.commands.length,row.commands);
    assert.equal(r.state.gold,r.state.log.reduce((n,l)=>n+l.goldDelta,0));
    let balance=0;for(const l of r.state.log){balance+=l.goldDelta;assert.ok(balance>=0);}
    assert.equal(r.commands.filter(c=>c.type==='buyCharm').length,row.actionCounts.buyCharm??0);
  }
  const comparison={baseline,current:output,policy:manifest.economy,old:previous.summary,new:current.summary,
    difference:current.summary.winRate-previous.summary.winRate,pairing,groups,
    spending:{before:previousSpending,after:currentSpending},pairs,
    audit:{uniqueSamples:1000,identicalInputsAndLeaders:true,all18StageCountsRecomputed:true,allGoldLedgersRecomputed:true,paidCommandsMatchLedgers:true},
  };
  await fs.writeFile(`${output}/comparison.json`,JSON.stringify(comparison,null,2));
  const lines=[
    '# 1000局购买与成长策略对照', '',
    `使用上一轮同一1000组种子、起手、先锋和标准难度。敌血、伤害、奖励、价格、布阵搜索与弃牌逻辑保持相同，改变战斗之间的购买与成长决策。新组运行前核对核心规则源码与基线快照一致。`, '',
    `基线：${previous.summary.wins}/${previous.summary.completed}通关（${pct(previous.summary.winRate)}）。新增策略：${current.summary.wins}/${current.summary.completed}通关（${pct(current.summary.winRate)}），相差${((current.summary.winRate-previous.summary.winRate)*100).toFixed(1)}个百分点。新组执行错误${current.summary.errors}，预算超限${current.summary.budgets}。`, '',
    '| 起手 | 战斗打法 | 先锋 | 样本 | 原通关 | 新通关 | 原通过率 | 新通过率 |',
    '|---|---|---|---:|---:|---:|---:|---:|',
    ...groups.map(g=>`| ${g.deck} | ${g.policy} | ${g.leader} | ${g.total} | ${g.oldWins} | ${g.newWins} | ${pct(g.oldRate)} | ${pct(g.newRate)} |`), '',
    `配对结果：原负新胜${pairing.oldLossNewWin}局，原胜新负${pairing.oldWinNewLoss}局，两组均胜${pairing.bothWin}局，两组均负${pairing.bothLoss}局，无效配对${pairing.invalid}局。`, '',
    '## 购买与提升实际执行', '',
    '次数来自成功提交的真实命令；金币支出独立来自账本逐笔扣款，已逐类核对次数相等。购买金额为售价全额，换购回收收入另留在原始账本中。不同策略活到的关卡不同，支出总量差异不能解释为单项操作的因果收益。', '',
    '| 操作 | 原使用局数 | 原次数 | 原支出 | 新使用局数 | 新次数 | 新支出 |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...currentSpending.map((s,i)=>`| ${s.name} | ${previousSpending[i].runs} | ${previousSpending[i].commands} | ${previousSpending[i].gold} | ${s.runs} | ${s.commands} | ${s.gold} |`), '',
    `免费强化成功提交${current.rows.reduce((n,r)=>n+(r.actionCounts.chooseEnhancement??0),0)}次，锦囊成长领取${current.rows.reduce((n,r)=>n+(r.actionCounts.chooseCharmReward??0),0)}次。`, '',
    '新增策略仅看当前公开候选、有效牌组和既往战报；按预期收益挑选强化/招募、锦囊换购/升阶与威力或增幅锻造。强化重抽每奖励最多2次，预留近期商店预算；军市刷新每店最多1次，资金充足时删低价值普通牌；锦囊加法排在乘法之前。', '',
    '此结果是整套购买与成长策略的配对效果，不能拆成“重抽单独提高多少胜率”。打法仍为有限搜索，没有未来抽牌信息和多手规划，不代表真人或最优通关率。本轮在正式1000局开始后不再调策略，不根据结果更换种子。', '',
    `1000份终局经实际存档校验，${current.replayed.length}局从开局逐命令存档导出/导入回放一致；另独立从1000份原始记录重算十八关人数、金币账本与配对身份。`, '',
    '## 数据', '',
    `数据目录：\`${output}/\`。comparison.json包含配对变化、消费次数/支出/发生关卡及独立核对；runs.ndjson保存每局全命令、终局、伤害来源与账本；runs.csv为逐局筛选表。基线数据没有覆盖。`, '',
    '---', '',
  ];
  const detailed=await fs.readFile(report,'utf8');
  await fs.writeFile(report,lines.join('\n')+detailed);
  console.log(JSON.stringify({economyComparison:{oldWins:previous.summary.wins,newWins:current.summary.wins,pairing,spending:currentSpending.map(({action,runs,commands,gold})=>({action,runs,commands,gold}))}}));
}
