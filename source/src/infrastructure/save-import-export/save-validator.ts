import type { ConfigRegistry } from '@config/config-registry';
import { err, ok, type Result } from '@shared/result';
import { SAVE_VERSION, type GameState } from '@domain/state/game-state';

/**
 * 存档结构与引用校验。
 *
 * 这一层回答两个问题：字段形状对不对、ID 引用在当前内容版本下是否还存在。
 * 它不解析 JSON、不做迁移——那些在 codec 与 migrations 里。
 * 每个检查带一个 stage，导入失败时能把原因精确指回具体分区。
 */

export type ValidationStage =
  | 'shape'
  | 'versions'
  | 'run'
  | 'rng'
  | 'zones'
  | 'instances'
  | 'references'
  | 'equipment'
  | 'battle'
  | 'choice'
  | 'history';

export interface ValidationFailure {
  readonly stage: ValidationStage;
  readonly reason: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function nonnegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function uniqueStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string') &&
    new Set(value).size === value.length
  );
}

/** 给人看的一行话：把阶段与原因并成「历史记录：历史记录条目无效」。 */
export function describeFailure(failure: ValidationFailure): string {
  return `${failure.stage}：${failure.reason}`;
}

export const ZONE_NAMES = ['drawPile', 'hand', 'playSlots', 'discardPile', 'consumed', 'removed'] as const;

interface Cursor {
  readonly cards: Readonly<Record<string, unknown>>;
  readonly seen: Set<string>;
}

function checkShape(value: unknown): ValidationFailure | null {
  if (!isRecord(value)) return { stage: 'shape', reason: '存档不是对象' };
  for (const key of ['meta', 'run', 'rng', 'cards', 'zones']) {
    if (!isRecord(value[key])) return { stage: 'shape', reason: `缺少 ${key} 分区` };
  }
  if (value.battle !== null && !isRecord(value.battle)) {
    return { stage: 'shape', reason: 'battle 必须是对象或 null' };
  }
  if (value.pendingChoice !== null && !isRecord(value.pendingChoice)) {
    return { stage: 'shape', reason: 'pendingChoice 必须是对象或 null' };
  }
  return null;
}

function checkVersions(value: Record<string, unknown>, registry: ConfigRegistry): ValidationFailure | null {
  const meta = value.meta as Record<string, unknown>;
  if (meta.saveVersion !== SAVE_VERSION) {
    return { stage: 'versions', reason: '存档版本与当前程序不匹配' };
  }
  if (meta.contentVersion !== registry.config.contentVersion) {
    return { stage: 'versions', reason: '存档的内容版本与当前卡池不匹配' };
  }
  if (typeof meta.appVersion !== 'string') {
    return { stage: 'versions', reason: '缺少程序版本' };
  }
  return null;
}

function checkRun(value: Record<string, unknown>, registry: ConfigRegistry): ValidationFailure | null {
  const run = value.run as Record<string, unknown>;
  const definition = typeof run.runDefinitionId === 'string'
    ? registry.getRunDefinition(run.runDefinitionId)
    : undefined;
  if (definition === undefined) return { stage: 'run', reason: '冒险流程定义不存在' };
  if (run.currentNodeId !== null &&
      !definition.nodes.some((node) => node.id === run.currentNodeId)) {
    return { stage: 'run', reason: '当前节点不在流程定义中' };
  }
  if (!['running', 'won', 'lost'].includes(String(run.status))) {
    return { stage: 'run', reason: '冒险状态取值非法' };
  }
  for (const field of ['gold', 'battlesWon', 'rerollsUsed']) {
    if (!nonnegativeInteger(run[field])) return { stage: 'run', reason: `${field} 必须为非负整数` };
  }
  return null;
}

function checkRng(value: Record<string, unknown>): ValidationFailure | null {
  const rng = value.rng as Record<string, unknown>;
  if (typeof rng.seed !== 'string') return { stage: 'rng', reason: '缺少随机种子' };
  if (!Number.isInteger(rng.cursor) || Number(rng.cursor) < 0) {
    return { stage: 'rng', reason: '随机游标非法' };
  }
  if (!Number.isInteger(rng.stream) ||
      Number(rng.stream) < 0 || Number(rng.stream) > 0xffffffff) {
    return { stage: 'rng', reason: '随机流状态非法' };
  }
  return null;
}

function checkZones(value: Record<string, unknown>, registry: ConfigRegistry): ValidationFailure | null {
  const zones = value.zones as Record<string, unknown>;
  for (const name of ZONE_NAMES) {
    if (!Array.isArray(zones[name])) return { stage: 'zones', reason: `${name} 不是数组` };
  }
  const playSlots = zones.playSlots as unknown[];
  const hand = zones.hand as unknown[];
  if (playSlots.length !== registry.config.battle.playSlotCount) {
    return { stage: 'zones', reason: '出牌框格数与当前规则不一致' };
  }
  if (hand.length > registry.config.battle.handLimit) {
    return { stage: 'zones', reason: '手牌数量超过上限' };
  }
  return null;
}

function checkInstances(value: Record<string, unknown>, registry: ConfigRegistry): ValidationFailure | null {
  const cards = value.cards as Record<string, unknown>;
  const knownSkills = new Set(registry.config.enhancement.legendarySkillPool.map((skill) => skill.id));
  for (const [instanceId, card] of Object.entries(cards)) {
    if (!isRecord(card)) return { stage: 'instances', reason: '卡牌实例不是对象' };
    if (card.instanceId !== instanceId) {
      return { stage: 'instances', reason: '实例 ID 与键不一致' };
    }
    if (typeof card.definitionId !== 'string' ||
        registry.getCardDefinition(card.definitionId) === undefined) {
      return { stage: 'instances', reason: `引用了不存在的卡定义 ${String(card.definitionId)}` };
    }
    const numericFields = [
      'permanentPower', 'permanentAmp', 'battleTemporaryPower', 'battleTemporaryAmp',
      'thisPlayPower', 'thisPlayAmp', 'morale',
    ];
    for (const field of numericFields) {
      if (!nonnegativeInteger(card[field])) {
        return { stage: 'instances', reason: `${field} 必须为非负整数` };
      }
    }
    if (!uniqueStrings(card.enhancementSkillIds) ||
        (card.enhancementSkillIds as string[]).some((id) => !knownSkills.has(id))) {
      return { stage: 'instances', reason: '附加技能列表无效或引用了不存在的技能' };
    }
    const owned = new Set(card.enhancementSkillIds as string[]);
    if (!uniqueStrings(card.usedEnhancementSkillIdsThisBattle) ||
        (card.usedEnhancementSkillIdsThisBattle as string[]).some((id) => !owned.has(id))) {
      return { stage: 'instances', reason: '已用技能必须是该卡拥有的技能' };
    }
    if (!Array.isArray(card.statuses) ||
        card.statuses.some((status: unknown) =>
          !isRecord(status) || typeof status.statusId !== 'string' ||
          !nonnegativeInteger(status.stacks) ||
          (status.remainingUses !== null && !nonnegativeInteger(status.remainingUses)))) {
      return { stage: 'instances', reason: '状态层无效' };
    }
    if (card.equippedToInstanceId !== null && typeof card.equippedToInstanceId !== 'string') {
      return { stage: 'instances', reason: '装备指向非法' };
    }
    if (card.slotIndex !== null && !nonnegativeInteger(card.slotIndex)) {
      return { stage: 'instances', reason: '格位索引非法' };
    }
  }
  return null;
}

function checkReferences(value: Record<string, unknown>, cursor: Cursor): ValidationFailure | null {
  const zones = value.zones as Record<string, unknown>;
  for (const listName of ZONE_NAMES) {
    const list = zones[listName] as unknown[];
    for (let index = 0; index < list.length; index += 1) {
      const id = list[index];
      if (id === null && listName === 'playSlots') continue;
      if (typeof id !== 'string') return { stage: 'references', reason: '牌区中存在非字符串 ID' };
      if (cursor.seen.has(id)) return { stage: 'references', reason: '同一张卡出现在多个牌区' };
      const card = cursor.cards[id];
      if (!isRecord(card) || card.instanceId !== id) {
        return { stage: 'references', reason: `牌区引用了不存在的卡牌 ${id}` };
      }
      if (listName === 'playSlots' && card.slotIndex !== index) {
        return { stage: 'references', reason: '出牌框内容与格位索引不一致' };
      }
      if (listName !== 'playSlots' && card.slotIndex !== null) {
        return { stage: 'references', reason: '非出牌框的卡牌不应带格位索引' };
      }
      cursor.seen.add(id);
    }
  }
  if (cursor.seen.size !== Object.keys(cursor.cards).length) {
    return { stage: 'references', reason: '存档中存在不属于任何牌区的游离卡牌' };
  }
  return null;
}

function checkEquipment(value: Record<string, unknown>, cursor: Cursor): ValidationFailure | null {
  const targets = value.equipmentTargets;
  if (!isRecord(targets)) return { stage: 'equipment', reason: '缺少装备目标表' };
  const slots = (value.zones as Record<string, unknown>).playSlots as unknown[];
  for (const [weaponId, rawTargetId] of Object.entries(targets)) {
    if (typeof rawTargetId !== 'string' ||
        !cursor.seen.has(weaponId) || !cursor.seen.has(rawTargetId) ||
        !slots.includes(weaponId) || !slots.includes(rawTargetId)) {
      return { stage: 'equipment', reason: '装备目标指向不在出牌框中的卡牌' };
    }
    if (Math.abs(slots.indexOf(weaponId) - slots.indexOf(rawTargetId)) !== 1) {
      return { stage: 'equipment', reason: '武器只能绑定相邻位置的卡' };
    }
  }
  return null;
}

function cardTypeIn(cursor: Cursor, registry: ConfigRegistry, id: string): string | undefined {
  const instance = cursor.cards[id];
  if (!isRecord(instance) || typeof instance.definitionId !== 'string') return undefined;
  return registry.getCardDefinition(instance.definitionId)?.cardType;
}

function checkEquipmentTypes(
  value: Record<string, unknown>,
  cursor: Cursor,
  registry: ConfigRegistry,
): ValidationFailure | null {
  for (const [weaponId, rawTargetId] of Object.entries((value.equipmentTargets ?? {}) as Record<string, unknown>)) {
    if (typeof rawTargetId !== 'string') continue;
    if (cardTypeIn(cursor, registry, weaponId) !== 'weapon' ||
        cardTypeIn(cursor, registry, rawTargetId) !== 'character') {
      return { stage: 'equipment', reason: '装备关系的卡类型不合法' };
    }
  }
  return null;
}

function checkBattle(value: Record<string, unknown>, registry: ConfigRegistry): ValidationFailure | null {
  if (value.battle === null) return null;
  const battle = value.battle as Record<string, unknown>;
  if (typeof battle.enemyDefinitionId !== 'string' ||
      registry.getEnemyDefinition(battle.enemyDefinitionId) === undefined) {
    return { stage: 'battle', reason: '敌人定义不存在' };
  }
  for (const field of ['enemyMaxHp', 'enemyCurrentHp', 'playCountRemaining',
    'discardCountRemaining', 'moraleTotal', 'completedPlays']) {
    if (!nonnegativeInteger(battle[field])) {
      return { stage: 'battle', reason: `${field} 必须为非负整数` };
    }
  }
  if (Number(battle.enemyCurrentHp) > Number(battle.enemyMaxHp)) {
    return { stage: 'battle', reason: '敌人当前生命超过上限' };
  }
  if (!['none', 'formed', 'array'].includes(String(battle.moraleTier))) {
    return { stage: 'battle', reason: '军势档位取值非法' };
  }
  if (!['in_progress', 'won', 'lost'].includes(String(battle.status))) {
    return { stage: 'battle', reason: '战斗状态取值非法' };
  }
  if (typeof battle.hasDiscardedThisBattle !== 'boolean') {
    return { stage: 'battle', reason: '弃牌标记必须是布尔值' };
  }
  return null;
}

function checkEnhancementChoice(
  value: Record<string, unknown>,
  cursor: Cursor,
  registry: ConfigRegistry,
): ValidationFailure | null {
  const choice = value.pendingChoice as Record<string, unknown>;
  const run = value.run as Record<string, unknown>;
  const definition = typeof run.runDefinitionId === 'string'
    ? registry.getRunDefinition(run.runDefinitionId)
    : undefined;
  const node = definition?.nodes.find((entry) => entry.id === run.currentNodeId);
  const candidates = choice.candidates;
  if (value.battle !== null || node?.type !== 'reward' || node.contentRef !== choice.stageId) {
    return { stage: 'choice', reason: '强化奖励与当前节点不匹配' };
  }
  if (!Array.isArray(candidates) ||
      candidates.length !== registry.config.enhancement.candidateCount) {
    return { stage: 'choice', reason: '强化候选数量与当前配置不一致' };
  }
  const targetIds = candidates.map((entry: unknown) =>
    isRecord(entry) ? entry.targetInstanceId : null);
  if (new Set(targetIds).size !== candidates.length) {
    return { stage: 'choice', reason: '强化候选目标重复' };
  }
  for (const entry of candidates) {
    if (!isRecord(entry) || typeof entry.id !== 'string' ||
        typeof entry.targetInstanceId !== 'string' ||
        !cursor.seen.has(entry.targetInstanceId) ||
        ((value.zones as Record<string, unknown>).removed as unknown[]).includes(entry.targetInstanceId) ||
        !['common', 'rare', 'legendary'].includes(String(entry.tier)) ||
        !['power', 'amp'].includes(String(entry.attribute))) {
      return { stage: 'choice', reason: '强化候选字段无效' };
    }
    const tier = entry.tier as 'common' | 'rare' | 'legendary';
    const attribute = entry.attribute as 'power' | 'amp';
    const expected: number = registry.config.enhancement.tierValues[tier][attribute];
    if (entry.amount !== expected) {
      return { stage: 'choice', reason: '强化数值与当前平衡配置不一致' };
    }
    const knownSkills = new Set(registry.config.enhancement.legendarySkillPool.map((skill) => skill.id));
    if (tier === 'legendary'
        ? typeof entry.skillId !== 'string' || !knownSkills.has(entry.skillId)
        : entry.skillId !== null) {
      return { stage: 'choice', reason: '传说强化的附加技能无效' };
    }
  }
  return null;
}

function checkChoice(
  value: Record<string, unknown>,
  cursor: Cursor,
  registry: ConfigRegistry,
): ValidationFailure | null {
  if (value.pendingChoice === null) return null;
  const choice = value.pendingChoice as Record<string, unknown>;
  if (typeof choice.kind !== 'string') {
    return { stage: 'choice', reason: '待处理选择缺少类型' };
  }
  if (choice.kind === 'enhancement_reward') return checkEnhancementChoice(value, cursor, registry);
  if (choice.kind === 'weapon_target') {
    const list = choice.candidateInstanceIds;
    if (typeof choice.weaponInstanceId !== 'string' ||
        !cursor.seen.has(choice.weaponInstanceId) ||
        !uniqueStrings(list) ||
        !list.every((id) => cursor.seen.has(id))) {
      return { stage: 'choice', reason: '装备目标选择的候选无效' };
    }
    return null;
  }
  return { stage: 'choice', reason: `未知的待处理选择类型 ${String(choice.kind)}` };
}

function checkHistory(value: Record<string, unknown>): ValidationFailure | null {
  const history = value.history;
  if (!Array.isArray(history)) return { stage: 'history', reason: '历史记录不是数组' };
  for (const entry of history) {
    if (!isRecord(entry) ||
        !['command', 'event'].includes(String(entry.kind)) ||
        typeof entry.type !== 'string' ||
        !isRecord(entry.payload)) {
      return { stage: 'history', reason: '历史记录条目无效' };
    }
  }
  return null;
}

/**
 * 逐分区校验一个已解析、已迁移的存档对象。
 *
 * 顺序有意义：形状 → 版本 → 各分区 → 交叉引用。引用类检查依赖 `cursor.seen`，
 * 必须排在实例检查之后。
 */
export function validateSave(
  value: unknown,
  registry: ConfigRegistry,
): Result<GameState, ValidationFailure> {
  const shapeFailure = checkShape(value);
  if (shapeFailure !== null) return err(shapeFailure);

  const state = value as Record<string, unknown>;
  const cursor: Cursor = {
    cards: state.cards as Record<string, unknown>,
    seen: new Set<string>(),
  };

  const checks: readonly (ValidationFailure | null)[] = [
    checkVersions(state, registry),
    checkRun(state, registry),
    checkRng(state),
    checkZones(state, registry),
    checkInstances(state, registry),
    checkReferences(state, cursor),
    checkEquipment(state, cursor),
    checkEquipmentTypes(state, cursor, registry),
    checkBattle(state, registry),
    checkChoice(state, cursor, registry),
    checkHistory(state),
  ];
  for (const failure of checks) {
    if (failure !== null) return err(failure);
  }
  return ok(state as unknown as GameState);
}
