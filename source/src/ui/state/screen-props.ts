import type { GameCommand } from '@app/command-validation';
import type { SelectorContext } from '@app/selectors';
import type { ConfigRegistry } from '@config/config-registry';
import type { GameState } from '@domain/state/game-state';
import type { UiActions, UiState } from './ui-store';

/**
 * 所有界面共用的入参。
 *
 * state 由 App 订阅控制器得到；selectors 提供定义表与规则（数值一律从这里读）；
 * registry 提供静态配置（敌人数值、匹配矩阵等展示用数据）；
 * dispatch 是唯一的状态写入口——界面永远不直接改 GameState。
 */

export interface ScreenProps {
  readonly state: GameState;
  readonly registry: ConfigRegistry;
  readonly selectors: SelectorContext;
  readonly ui: UiState;
  readonly actions: UiActions;
  /** 返回是否成功：失败原因由 App 统一提示，调用方只决定是否清理自己的操作态。 */
  readonly dispatch: (command: GameCommand) => boolean;
}
