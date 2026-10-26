import type { z } from 'zod';
import type { DefinitionId } from '@shared/branded-id';
import { isErr, ok, err, type Result } from '@shared/result';
import { AppErrorCode, createAppError, type AppError } from '@shared/error-codes';
import { CardDefinitionSchema, type CardDefinitionConfig } from './schemas/card.schema';
import { EnemyDefinitionSchema, type EnemyDefinitionConfig } from './schemas/enemy.schema';
import { RunDefinitionSchema, type RunDefinitionConfig } from './schemas/run.schema';
import {
  BattleBalanceSchema,
  DamageBalanceSchema,
  EconomyBalanceSchema,
  EnhancementBalanceSchema,
  MatchMatrixSchema,
  MoraleBalanceSchema,
  type BattleBalance,
  type DamageBalance,
  type EconomyBalance,
  type EnhancementBalance,
  type MatchMatrix,
  type MoraleBalance,
} from './schemas/balance.schema';
import { PresentationSchema, type PresentationConfig } from './schemas/presentation.schema';
import { EffectConfigSchema } from './schemas/effect.schema';

/**
 * 配置验证。
 *
 * 错误必须带来源文件与字段路径，便于在启动或加载阶段集中报告。
 */

export interface ConfigIssue {
  readonly source: string;
  readonly path: string;
  readonly message: string;
}

export interface ValidatedContent {
  readonly cards: readonly CardDefinitionConfig[];
  readonly enemies: readonly EnemyDefinitionConfig[];
  readonly run: RunDefinitionConfig;
  readonly enhancement: EnhancementBalance;
}

export interface ValidatedBalance {
  readonly battle: BattleBalance;
  readonly damage: DamageBalance;
  readonly morale: MoraleBalance;
  readonly matchMatrix: MatchMatrix;
  readonly economy: EconomyBalance;
}

export interface ValidatedPresentation {
  readonly presentation: PresentationConfig;
}

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  source: string,
): Result<T, ConfigIssue[]> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    parsed.error.issues.map((issue) => ({
      source,
      path: issue.path.join('.'),
      message: issue.message,
    })),
  );
}

function parseArrayWithSchema<T>(
  schema: z.ZodType<T>,
  raw: readonly unknown[],
  source: string,
): Result<readonly T[], ConfigIssue[]> {
  const items: T[] = [];
  const issues: ConfigIssue[] = [];
  raw.forEach((entry, index) => {
    const parsed = schema.safeParse(entry);
    if (parsed.success) {
      items.push(parsed.data);
      return;
    }
    for (const issue of parsed.error.issues) {
      issues.push({ source, path: `[${index}].${issue.path.join('.')}`, message: issue.message });
    }
  });
  return issues.length === 0 ? ok(items) : err(issues);
}

function collect<T>(result: Result<T, ConfigIssue[]>, issues: ConfigIssue[]): T | null {
  if (isErr(result)) {
    issues.push(...result.error);
    return null;
  }
  return result.value;
}

/**
 * 内容校验：Schema、ID 唯一性与跨文件引用完整性。
 */
export function validateContent(raw: {
  cards: readonly unknown[];
  enemies: readonly unknown[];
  run: unknown;
  enhancement: unknown;
}): Result<ValidatedContent, ConfigIssue[]> {
  const issues: ConfigIssue[] = [];

  const cardsResult = parseArrayWithSchema(CardDefinitionSchema, raw.cards, 'content/cards');
  const enemiesResult = parseArrayWithSchema(EnemyDefinitionSchema, raw.enemies, 'content/enemies');
  const runResult = parseWithSchema(RunDefinitionSchema, raw.run, 'content/runs');
  const enhancementResult = parseWithSchema(EnhancementBalanceSchema, raw.enhancement, 'content/rewards');

  const cards = collect(cardsResult, issues);
  const enemies = collect(enemiesResult, issues);
  const run = collect(runResult, issues);
  const enhancement = collect(enhancementResult, issues);
  if (cards === null || enemies === null || run === null || enhancement === null) {
    return err(issues);
  }

  const seenCardIds = new Set<string>();
  for (const card of cards) {
    if (seenCardIds.has(card.id)) {
      issues.push({ source: 'content/cards', path: card.id, message: `卡牌定义 ID 重复：${card.id}` });
    }
    seenCardIds.add(card.id);

    const seenEffectIds = new Set<string>();
    for (const effect of card.effects) {
      if (seenEffectIds.has(effect.effectId)) {
        issues.push({
          source: 'content/cards',
          path: `${card.id}.effects.${effect.effectId}`,
          message: `同一张卡内的效果 ID 重复：${effect.effectId}`,
        });
      }
      seenEffectIds.add(effect.effectId);
    }
  }

  const seenEnemyIds = new Set<string>();
  for (const enemy of enemies) {
    if (seenEnemyIds.has(enemy.id)) {
      issues.push({ source: 'content/enemies', path: enemy.id, message: `敌人定义 ID 重复：${enemy.id}` });
    }
    seenEnemyIds.add(enemy.id);
  }

  const seenNodeIds = new Set<string>();
  for (const node of run.nodes) {
    if (seenNodeIds.has(node.id)) {
      issues.push({ source: 'content/runs', path: node.id, message: `流程节点 ID 重复：${node.id}` });
    }
    seenNodeIds.add(node.id);
  }

  if (!seenNodeIds.has(run.startNodeId)) {
    issues.push({
      source: 'content/runs',
      path: 'startNodeId',
      message: `起始节点不存在：${run.startNodeId}`,
    });
  }

  for (const node of run.nodes) {
    if (node.nextNodeId !== null && !seenNodeIds.has(node.nextNodeId)) {
      issues.push({
        source: 'content/runs',
        path: `${node.id}.nextNodeId`,
        message: `后继节点不存在：${node.nextNodeId}`,
      });
    }
    if (node.type === 'battle' && !seenEnemyIds.has(node.contentRef)) {
      issues.push({
        source: 'content/runs',
        path: `${node.id}.contentRef`,
        message: `战斗节点引用了不存在的敌人：${node.contentRef}`,
      });
    }
    if (node.type === 'reward' && enhancement.stageWeights[node.contentRef] === undefined) {
      issues.push({
        source: 'content/runs',
        path: `${node.id}.contentRef`,
        message: `奖励节点引用了不存在的概率表：${node.contentRef}`,
      });
    }
  }

  return issues.length === 0 ? ok({ cards, enemies, run, enhancement }) : err(issues);
}

export function validateBalance(raw: {
  battle: unknown;
  damage: unknown;
  morale: unknown;
  matchMatrix: unknown;
  economy: unknown;
}): Result<ValidatedBalance, ConfigIssue[]> {
  const issues: ConfigIssue[] = [];
  const battle = collect(parseWithSchema(BattleBalanceSchema, raw.battle, 'balance/battle'), issues);
  const damage = collect(parseWithSchema(DamageBalanceSchema, raw.damage, 'balance/damage'), issues);
  const morale = collect(parseWithSchema(MoraleBalanceSchema, raw.morale, 'balance/morale'), issues);
  const matchMatrix = collect(parseWithSchema(MatchMatrixSchema, raw.matchMatrix, 'balance/match-matrix'), issues);
  const economy = collect(parseWithSchema(EconomyBalanceSchema, raw.economy, 'balance/economy'), issues);

  if (battle === null || damage === null || morale === null || matchMatrix === null || economy === null) {
    return err(issues);
  }

  return ok({ battle, damage, morale, matchMatrix, economy });
}

export function validatePresentation(raw: unknown): Result<ValidatedPresentation, ConfigIssue[]> {
  const parsed = parseWithSchema(PresentationSchema, raw, 'presentation/presentation');
  return isErr(parsed) ? err(parsed.error) : ok({ presentation: parsed.value });
}

export function configIssuesToAppError(issues: readonly ConfigIssue[]): AppError {
  return createAppError(AppErrorCode.ConfigInvalid, '配置验证未通过', {
    issueCount: issues.length,
    firstIssue: issues[0] === undefined ? '' : `${issues[0].source}:${issues[0].path}`,
  });
}

export { EffectConfigSchema };
export type { CardDefinitionConfig, EnemyDefinitionConfig, RunDefinitionConfig };
export type { DefinitionId };
