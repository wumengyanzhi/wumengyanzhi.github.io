import type { EffectConfig, EffectOperation } from '@config/schemas/effect.schema';

/**
 * 卡面文案渲染。
 *
 * 只把配置里已有的时机、条件和操作翻译成中文句子，不参与任何结算判断；
 * 数值全部从配置读取，界面不持有任何卡面数字。
 */

export interface SkillText {
  readonly title: string;
  readonly body: string;
}

const TIMING_TEXT: Readonly<Record<EffectConfig['timing'], string>> = {
  on_play: '出战时',
  after_resolve: '结算后',
  on_battle_end: '战斗结束时',
};

const SCOPE_TEXT: Readonly<Record<'this_play' | 'this_battle' | 'permanent', string>> = {
  this_play: '',
  this_battle: '本场',
  permanent: '本局永久',
};

const TARGET_TEXT: Readonly<Record<string, string>> = {
  self: '自身',
  zone: '本次出战整体',
  equipped_character: '所装备的人物',
  left_neighbour: '左邻卡牌',
  right_neighbour: '右邻卡牌',
};

const CARD_TYPE_TEXT: Readonly<Record<string, string>> = {
  character: '人物',
  weapon: '武器',
  tactic: '战术',
  event: '事件',
};

const RELATION_TEXT: Readonly<Record<string, string>> = {
  main: '本职',
  usable: '可用',
  off: '偏门',
  none: '不匹配',
};

function targetText(target: string): string {
  return TARGET_TEXT[target] ?? target;
}

function describeCondition(effect: EffectConfig): string | null {
  const condition = effect.condition;
  switch (condition.type) {
    case 'always':
      return null;
    case 'self_equipped_weapon_relation':
      return `装备${RELATION_TEXT[condition.relation] ?? condition.relation}兵器时`;
    case 'self_adjacent_both':
      return `左右相邻均为${CARD_TYPE_TEXT[condition.cardType] ?? condition.cardType}时`;
    case 'play_contains_card_type':
      return `本次出战含至少 ${condition.min} 张${CARD_TYPE_TEXT[condition.cardType] ?? condition.cardType}时`;
    case 'play_contains_distinct_card_types':
      return `本次出战含 ${condition.min} 种卡牌类型时`;
    case 'discarded_this_battle':
      return `本场已主动弃牌至少 ${condition.min} 张时`;
    default:
      return null;
  }
}

function describeOperation(operation: EffectOperation): string {
  if (operation.type === 'add_power' || operation.type === 'add_amp') {
    const stat = operation.type === 'add_power' ? '威力' : '增幅';
    const scope = SCOPE_TEXT[operation.scope] ?? '';
    const target = targetText(operation.target);
    const head = `${scope}${target}${stat} +${operation.value}`;
    if (operation.scale === undefined) return head;
    const counted = CARD_TYPE_TEXT[operation.scale.countCardType] ?? operation.scale.countCardType;
    const base = operation.value === 0
      ? `${target}${stat}每张${counted} +${operation.scale.each}`
      : `${head}，每张${counted}额外 +${operation.scale.each}`;
    return `${base}（上限 ${operation.scale.max}）`;
  }
  switch (operation.type) {
    case 'gain_gold':
      return `获得 ${operation.value} 金币`;
    case 'consume_resource':
      return `消耗 ${operation.amount} ${operation.resource === 'gold' ? '金币' : operation.resource}`;
    case 'draw_cards':
      return `抽 ${operation.count} 张牌`;
    case 'move_card':
      return `将${targetText(operation.target)}移至 ${operation.to}`;
    case 'add_temporary_stat':
      return `${targetText(operation.target)}本场临时 威力 +${operation.power} 增幅 +${operation.amp}`;
    case 'add_permanent_card_stat':
      return `${targetText(operation.target)}本局永久 威力 +${operation.power} 增幅 +${operation.amp}`;
    case 'apply_status':
      return `为${targetText(operation.target)}附加 ${operation.stacks} 层 ${operation.statusId}`;
    case 'change_effective_value':
      return `吸收${targetText(operation.from)}的${operation.mode === 'absorb_power' ? '威力' : '增幅'}`;
    case 'repeat_effect':
      return `重复结算 ${operation.effectId} ${operation.times} 次`;
    case 'inspect_and_reorder_deck':
      return `查看抽牌堆顶 ${operation.count} 张并放回${operation.to === 'top' ? '顶部' : '底部'}`;
    default:
      return '未知操作';
  }
}

export function describeEffect(effect: EffectConfig): SkillText {
  const condition = describeCondition(effect);
  const body = effect.operations.map(describeOperation).join('；');
  return {
    title: TIMING_TEXT[effect.timing] ?? effect.timing,
    body: condition === null ? `${body}。` : `${condition}，${body}。`,
  };
}

export function describeEffects(effects: readonly EffectConfig[]): readonly SkillText[] {
  return effects.map(describeEffect);
}
