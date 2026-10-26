import { z } from 'zod';
import { RUN_NODE_TYPES } from '@domain/models/enums';

/**
 * 流程配置。
 *
 * 三战顺序必须来自本配置；领域系统不得用战斗序号判断具体敌人或奖励。
 * 最后一个节点没有后继节点，代表本局通关。
 */
export const RunNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(RUN_NODE_TYPES),
  contentRef: z.string().min(1),
  nextNodeId: z.string().min(1).nullable(),
});

export const RunDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  startNodeId: z.string().min(1),
  nodes: z.array(RunNodeSchema).min(1),
});

export type RunNodeConfig = z.infer<typeof RunNodeSchema>;
export type RunDefinitionConfig = z.infer<typeof RunDefinitionSchema>;
