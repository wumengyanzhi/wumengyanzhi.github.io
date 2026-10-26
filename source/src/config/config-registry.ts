import type { Result } from '@shared/result';
import { err, ok } from '@shared/result';
import type { CardDefinitionConfig } from './schemas/card.schema';
import type { EnemyDefinitionConfig } from './schemas/enemy.schema';
import type { RunDefinitionConfig } from './schemas/run.schema';
import type {
  BattleBalance,
  DamageBalance,
  EconomyBalance,
  EnhancementBalance,
  MatchMatrix,
  MoraleBalance,
} from './schemas/balance.schema';
import type { PresentationConfig } from './schemas/presentation.schema';
import {
  validateBalance,
  validateContent,
  validatePresentation,
  type ConfigIssue,
  type ValidatedBalance,
  type ValidatedContent,
} from './config-validator';

import charactersJson from './content/cards/characters.json';
import weaponsJson from './content/cards/weapons.json';
import tacticsJson from './content/cards/tactics.json';
import enemiesJson from './content/enemies/enemies.json';
import threeBattleJson from './content/runs/three-battle.json';
import enhancementJson from './content/rewards/enhancement.json';
import battleBalanceJson from './balance/battle.json';
import damageBalanceJson from './balance/damage.json';
import moraleBalanceJson from './balance/morale.json';
import matchMatrixJson from './balance/match-matrix.json';
import economyBalanceJson from './balance/economy.json';
import presentationJson from './presentation/presentation.json';

/** 内容版本：卡牌、敌人与平衡配置发生变化时提升。 */
export const CONTENT_VERSION = '0.1.0';

/**
 * 运行时有效配置。
 *
 * 领域系统只读取这里的只读视图，不得直接导入任何 JSON 文件。
 */
export interface EffectiveConfig {
  readonly contentVersion: string;
  readonly cards: ReadonlyMap<string, CardDefinitionConfig>;
  readonly enemies: ReadonlyMap<string, EnemyDefinitionConfig>;
  readonly runs: ReadonlyMap<string, RunDefinitionConfig>;
  readonly enhancement: EnhancementBalance;
  readonly battle: BattleBalance;
  readonly damage: DamageBalance;
  readonly morale: MoraleBalance;
  readonly matchMatrix: MatchMatrix;
  readonly economy: EconomyBalance;
  readonly presentation: PresentationConfig;
}

export interface ConfigRegistry {
  readonly config: EffectiveConfig;
  getCardDefinition(id: string): CardDefinitionConfig | undefined;
  getEnemyDefinition(id: string): EnemyDefinitionConfig | undefined;
  getRunDefinition(id: string): RunDefinitionConfig | undefined;
  listCardDefinitions(): readonly CardDefinitionConfig[];
  listEnemyDefinitions(): readonly EnemyDefinitionConfig[];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

export function buildEffectiveConfig(
  content: ValidatedContent,
  balance: ValidatedBalance,
  presentation: PresentationConfig,
): EffectiveConfig {
  const cards = new Map<string, CardDefinitionConfig>();
  for (const card of content.cards) {
    cards.set(card.id, card);
  }
  const enemies = new Map<string, EnemyDefinitionConfig>();
  for (const enemy of content.enemies) {
    enemies.set(enemy.id, enemy);
  }
  const runs = new Map<string, RunDefinitionConfig>();
  runs.set(content.run.id, content.run);

  return deepFreeze({
    contentVersion: CONTENT_VERSION,
    cards,
    enemies,
    runs,
    enhancement: content.enhancement,
    battle: balance.battle,
    damage: balance.damage,
    morale: balance.morale,
    matchMatrix: balance.matchMatrix,
    economy: balance.economy,
    presentation,
  } satisfies EffectiveConfig);
}

/**
 * 由一份 EffectiveConfig 反推出配置注册中心。
 *
 * 调参面板拿到的就是「基础配置 + 运行时补丁」合成出来的新 EffectiveConfig，
 * 需要跟基础配置走同一套只读访问接口，否则界面与领域会各走一条路径。
 */
export function createRegistryFromConfig(config: EffectiveConfig): ConfigRegistry {
  return {
    config,
    getCardDefinition(id: string): CardDefinitionConfig | undefined {
      return config.cards.get(id);
    },
    getEnemyDefinition(id: string): EnemyDefinitionConfig | undefined {
      return config.enemies.get(id);
    },
    getRunDefinition(id: string): RunDefinitionConfig | undefined {
      return config.runs.get(id);
    },
    listCardDefinitions(): readonly CardDefinitionConfig[] {
      return [...config.cards.values()];
    },
    listEnemyDefinitions(): readonly EnemyDefinitionConfig[] {
      return [...config.enemies.values()];
    },
  };
}

/**
 * 加载并验证基础配置，返回只读的配置注册中心。
 */
export function createConfigRegistry(): Result<ConfigRegistry, readonly ConfigIssue[]> {
  const content = validateContent({
    cards: [...charactersJson, ...weaponsJson, ...tacticsJson],
    enemies: enemiesJson,
    run: threeBattleJson,
    enhancement: enhancementJson,
  });
  if (content.ok === false) {
    return err(content.error);
  }

  const balance = validateBalance({
    battle: battleBalanceJson,
    damage: damageBalanceJson,
    morale: moraleBalanceJson,
    matchMatrix: matchMatrixJson,
    economy: economyBalanceJson,
  });
  if (balance.ok === false) {
    return err(balance.error);
  }

  const presentation = validatePresentation(presentationJson);
  if (presentation.ok === false) {
    return err(presentation.error);
  }

  const config = buildEffectiveConfig(content.value, balance.value, presentation.value.presentation);

  return ok({
    config,
    getCardDefinition(id: string): CardDefinitionConfig | undefined {
      return config.cards.get(id);
    },
    getEnemyDefinition(id: string): EnemyDefinitionConfig | undefined {
      return config.enemies.get(id);
    },
    getRunDefinition(id: string): RunDefinitionConfig | undefined {
      return config.runs.get(id);
    },
    listCardDefinitions(): readonly CardDefinitionConfig[] {
      return [...config.cards.values()];
    },
    listEnemyDefinitions(): readonly EnemyDefinitionConfig[] {
      return [...config.enemies.values()];
    },
  });
}
