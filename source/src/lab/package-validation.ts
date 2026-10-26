import { createRegistryFromConfig,type EffectiveConfig } from '@config/config-registry';
import type { BattleEvent } from '@domain/events/battle-events';
import { isRecord,validateSave } from '@infra/save-import-export/save-validator';
import { canonical,fingerprint,restoreConfig } from './config-snapshot';
import { createRun } from './runner';
import { replayAt } from './replay';
import { ENGINE_VERSION,RNG_VERSION,POLICY_IDS,type BatchSnapshot,type FrozenVariant,type RunRecord,type ConfigSnapshot } from './model';

const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
const integer=(value:unknown,min=0):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min;
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const commandTypes=['NewRun','StageCard','UnstageCard','SelectWeaponTarget','Play','Discard','RerollEnhancement','ChooseEnhancement'];
export async function validatePackageSnapshot(s:BatchSnapshot):Promise<boolean>{
  const m=s?.manifest;
  if(!m||!Array.isArray(s.records)||!Array.isArray(m.variants)||!m.variants.length||!Array.isArray(m.policies)||!m.policies.length||!Array.isArray(m.seeds)||!m.seeds.length||!integer(m.plannedRuns,1)||m.plannedRuns>20000)throw new Error('实验清单为空或超出 20,000 局预算');
  if(!text(m.id)||!text(m.name)||!text(m.engineVersion)||!text(m.bootstrapSeed)||m.ruleset!=='legacy_mvp'||m.rngVersion!==RNG_VERSION||!['whole-run','battle','same-action'].includes(m.mode)||!['exploration','holdout'].includes(m.split)||m.policies.some((p)=>!POLICY_IDS.includes(p))||m.seeds.some((seed)=>!text(seed)))throw new Error('清单版本、规则、模式或策略未支持');
  const budgetKeys=['commands','evaluations','timeoutMs','storageBytes'] as const;
  if(!m.budgets||Object.keys(m.budgets).length!==4||budgetKeys.some((key)=>!Object.hasOwn(m.budgets,key)||!integer(m.budgets[key],1)))throw new Error('执行预算无效');
  if(m.plannedRuns!==m.variants.length*m.policies.length*m.seeds.length||s.records.length!==m.plannedRuns||new Set(m.policies).size!==m.policies.length||new Set(m.seeds).size!==m.seeds.length||new Set(m.variants.map((v)=>v.id)).size!==m.variants.length)throw new Error('清单数量或去重不一致');
  if(m.mode==='whole-run'&&m.scenario)throw new Error('整局实验不能混入手工场景');
  if(m.mode!=='whole-run'&&(!m.scenario||m.seeds.length!==1||m.seeds[0]!==m.scenario.state?.rng?.seed))throw new Error('局部场景或原种子不一致');
  if(m.mode==='same-action'&&(!m.fixedCommands?.length||m.fixedCommands.at(-1)?.type!=='Play'||m.fixedCommands.filter((c)=>c.type==='Play').length!==1||m.fixedCommands.some((c)=>!['StageCard','UnstageCard','SelectWeaponTarget','Play'].includes(c.type))))throw new Error('固定动作必须以唯一一次出战结束');
  if(!['running','paused','stopped','completed'].includes(s.status))throw new Error('批次状态无效');
  const readOnly=m.engineVersion!==ENGINE_VERSION;
  const registries=new Map<string,ReturnType<typeof createRegistryFromConfig>>();
  for(const v of m.variants as readonly FrozenVariant[]){
    if(!text(v.name)||!hash(v.id)||v.id!==v.hash||await fingerprint(v.config)!==v.hash)throw new Error('配置指纹不一致');
    if(!Array.isArray(v.config.cards)||!Array.isArray(v.config.enemies)||!Array.isArray(v.config.runs)||v.config.cards.some((c:ConfigSnapshot['cards'][number])=>!text(c.id)||!text(c.name))||v.config.enemies.some((e:ConfigSnapshot['enemies'][number])=>!text(e.id)||!text(e.name)))throw new Error('内容快照结构不完整');
    if(v.config.cards.length!==20||v.config.runs.length!==1||v.config.runs[0]?.nodes.filter((n:ConfigSnapshot['runs'][number]['nodes'][number])=>n.type==='battle').length!==3)throw new Error('该内容不属于旧三战实验包格式');
    const config=readOnly?{...v.config,cards:new Map((v.config.cards as ConfigSnapshot['cards']).map((c)=>[c.id,c])),enemies:new Map((v.config.enemies as ConfigSnapshot['enemies']).map((e)=>[e.id,e])),runs:new Map((v.config.runs as ConfigSnapshot['runs']).map((r)=>[r.id,r]))} as EffectiveConfig:restoreConfig(v.config);
    registries.set(v.id,createRegistryFromConfig(config));
  }
  const identities=new Set<string>(),fingerprints=new Set<string>();
  for(const r of s.records as readonly RunRecord[]){
    if(!isRecord(r)||!text(r.key)||!text(r.fingerprint)||!text(r.seed)||!text(r.variantId)||!m.variants.some((v)=>v.id===r.variantId)||!m.policies.includes(r.policy)||!m.seeds.includes(r.seed)||!Array.isArray(r.frames)||!Array.isArray(r.checkpoints)||!Array.isArray(r.pendingCommands)||!integer(r.evaluations)||!integer(r.attemptId,1))throw new Error('样本身份或引用无效');
    const identity=`${r.variantId}|${r.policy}|${r.seed}`;if(identities.has(identity)||fingerprints.has(r.fingerprint))throw new Error('重复逻辑样本或样本指纹');identities.add(identity);fingerprints.add(r.fingerprint);
    if(!['pending','running','paused','completed','error','budget_exceeded','timeout','cancelled'].includes(r.status)||!['complete','trace_incomplete'].includes(r.quality)||r.reason!==undefined&&typeof r.reason!=='string')throw new Error('样本状态或质量无效');
    if(r.outcome!==undefined&&(r.status!=='completed'||!['won','lost'].includes(r.outcome)))throw new Error('胜负状态无效');
    if(r.status==='completed'&&(!r.finalState||!r.frames.length||m.mode!=='same-action'&&r.outcome===undefined))throw new Error('样本没有合法终局或动作窗口');
    if(r.status==='pending'&&(r.frames.length||r.finalState||r.checkpoints.length))throw new Error('未开始样本包含已执行状态');
    if(r.frames.length>m.budgets.commands||r.evaluations>m.budgets.evaluations)throw new Error('记录超过声明执行预算');
    for(const frame of r.frames){
      if(!isRecord(frame.command)||!text(frame.command.type)||!readOnly&&!commandTypes.includes(frame.command.type)||!hash(frame.beforeHash)||!hash(frame.afterHash)||!Array.isArray(frame.events)||!Array.isArray(frame.trace)||!integer(frame.battleIndex,1)||!integer(frame.goldBefore)||!integer(frame.goldAfter)||!integer(frame.rngBefore)||!integer(frame.rngAfter)||frame.enemyHpBefore!==null&&!integer(frame.enemyHpBefore))throw new Error('命令或事件记录结构无效');
      for(const e of frame.events){if(!isRecord(e)||!text(e.type))throw new Error('领域事件结构无效');if(e.type==='DamageResolved'&&['amount','powerTotal','ampTotal','enemyHpAfter'].some((key)=>!integer(e[key])))throw new Error('伤害事件数值无效');}
      for(const t of frame.trace)if(!isRecord(t)||!text(t.kind)||typeof t.source!=='string'||typeof t.label!=='string'||typeof t.timing!=='string')throw new Error('诊断记录结构无效');
      if(frame.decision&&(!text(frame.decision.reason)||!Array.isArray(frame.decision.commands)||!integer(frame.decision.evaluated)))throw new Error('决策记录结构无效');
    }
    const registry=registries.get(r.variantId)!;
    for(const cp of r.checkpoints){
      if(!integer(cp.afterFrames)||cp.afterFrames>r.frames.length||!hash(cp.hash)||!validateSave(cp.state,registry).ok||await fingerprint(cp.state)!==cp.hash||cp.afterFrames>0&&r.frames[cp.afterFrames-1]?.afterHash!==cp.hash)throw new Error('检查点状态或散列不一致');
    }
    if(r.finalState){
      if(!validateSave(r.finalState,registry).ok||r.finalState.rng.seed!==r.seed)throw new Error('终局或恢复状态无效');
      if(r.frames.length&&await fingerprint(r.finalState)!==r.frames.at(-1)?.afterHash)throw new Error('终态与最后命令散列不一致');
      if(r.status==='completed'&&m.mode==='whole-run'&&r.finalState.run.status!==r.outcome)throw new Error('胜负与合法终局不一致');
      if(r.status==='completed'&&m.mode!=='whole-run'){
        const lastEvents:readonly BattleEvent[]=r.frames.at(-1)?.events??[];
        const expected=r.finalState.run.status==='won'||lastEvents.some((e)=>e.type==='BattleWon')?'won':r.finalState.run.status==='lost'||lastEvents.some((e)=>e.type==='BattleLost')?'lost':undefined;
        if(r.outcome!==expected||m.mode==='battle'&&expected===undefined)throw new Error('局部胜负与合法终局不一致');
        if(m.mode==='same-action'&&canonical(r.frames.map((f)=>f.command))!==canonical(m.fixedCommands))throw new Error('固定动作窗口没有完整执行声明命令');
      }
    }
    if(!readOnly&&r.status!=='pending'){
      const v=m.variants.find((v)=>v.id===r.variantId)!;
      const fresh=await createRun(m,v,r.policy,r.seed);
      if(r.fingerprint!==fresh.record.fingerprint||r.key!==fresh.record.key)throw new Error('样本与冻结清单身份不一致');
      const initial=fresh.record.checkpoints.filter((c)=>c.afterFrames===0);
      const replayed=await replayAt(v,{frames:r.frames,checkpoints:initial,quality:r.quality},r.frames.length);
      if(canonical(replayed)!==canonical(r.finalState??null))throw new Error('命令重放与恢复状态不一致');
    }
  }
  if((s.status==='completed'||s.status==='stopped')&&s.records.some((r)=>['pending','running','paused'].includes(r.status)))throw new Error('终态批次仍含未完成样本');
  return readOnly;
}
