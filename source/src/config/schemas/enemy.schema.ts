import { z } from 'zod';
import { ENEMY_BEHAVIORS, ENEMY_TYPES } from '@domain/models/enums';

/**
 * 敌人配置。
 *
 * MVP 敌人只保存定义 ID、名称、类型、最大生命与行为；
 * 后期通过新的 EnemyBehavior 扩展行动、阶段与状态，不改这里的接口。
 */
export const EnemyDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(ENEMY_TYPES),
  maxHp: z.number().int().positive(),
  behavior: z.enum(ENEMY_BEHAVIORS),
});

export type EnemyDefinitionConfig = z.infer<typeof EnemyDefinitionSchema>;
