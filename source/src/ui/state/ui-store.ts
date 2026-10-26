import { useCallback, useState } from 'react';
import type { InstanceId } from '@domain/models/ids';

/**
 * UI State。
 *
 * 规则 says：拖拽光标、悬停、临时阴影、当前选中的牌属于 UI State；
 * 手牌顺序、出牌框位置、装备关系属于 GameState，绝不放进来。
 * 这一层只负责「玩家正在操作什么」，不参与任何规则判断。
 */

export interface Notice {
  readonly kind: 'info' | 'error';
  readonly text: string;
}

export interface UiState {
  readonly selectedHand: InstanceId | null;
  readonly discardIds: readonly InstanceId[];
  readonly detailInstanceId: InstanceId | null;
  readonly targetWeaponId: InstanceId | null;
  readonly animationsEnabled: boolean;
  readonly notice: Notice | null;
  readonly lastDamage: number | null;
  readonly lastDamageToken: number;
}

export interface UiActions {
  selectHand(id: InstanceId | null): void;
  toggleDiscard(id: InstanceId): void;
  clearDiscard(): void;
  openDetail(id: InstanceId): void;
  closeDetail(): void;
  openTargets(weaponInstanceId: InstanceId): void;
  closeTargets(): void;
  setAnimationsEnabled(enabled: boolean): void;
  setNotice(notice: Notice | null): void;
  reportDamage(amount: number): void;
  reset(): void;
}

export function useUiState(): { readonly ui: UiState; readonly actions: UiActions } {
  const [selectedHand, setSelectedHand] = useState<InstanceId | null>(null);
  const [discardIds, setDiscardIds] = useState<readonly InstanceId[]>([]);
  const [detailInstanceId, setDetailInstanceId] = useState<InstanceId | null>(null);
  const [targetWeaponId, setTargetWeaponId] = useState<InstanceId | null>(null);
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastDamage, setLastDamage] = useState<number | null>(null);
  const [lastDamageToken, setLastDamageToken] = useState(0);

  const selectHand = useCallback((id: InstanceId | null): void => {
    setSelectedHand(id);
  }, []);

  const toggleDiscard = useCallback((id: InstanceId): void => {
    setDiscardIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  }, []);

  const clearDiscard = useCallback((): void => {
    setDiscardIds([]);
  }, []);

  const openDetail = useCallback((id: InstanceId): void => {
    setDetailInstanceId(id);
  }, []);

  const closeDetail = useCallback((): void => {
    setDetailInstanceId(null);
  }, []);

  const openTargets = useCallback((weaponInstanceId: InstanceId): void => {
    setTargetWeaponId(weaponInstanceId);
  }, []);

  const closeTargets = useCallback((): void => {
    setTargetWeaponId(null);
  }, []);

  const setAnimations = useCallback((enabled: boolean): void => {
    setAnimationsEnabled(enabled);
  }, []);

  const setNoticeState = useCallback((next: Notice | null): void => {
    setNotice(next);
  }, []);

  const reportDamage = useCallback((amount: number): void => {
    setLastDamage(amount);
    setLastDamageToken((token) => token + 1);
  }, []);

  const reset = useCallback((): void => {
    setSelectedHand(null);
    setDiscardIds([]);
    setDetailInstanceId(null);
    setTargetWeaponId(null);
    setLastDamage(null);
  }, []);

  return {
    ui: {
      selectedHand,
      discardIds,
      detailInstanceId,
      targetWeaponId,
      animationsEnabled,
      notice,
      lastDamage,
      lastDamageToken,
    },
    actions: {
      selectHand,
      toggleDiscard,
      clearDiscard,
      openDetail,
      closeDetail,
      openTargets,
      closeTargets,
      setAnimationsEnabled: setAnimations,
      setNotice: setNoticeState,
      reportDamage,
      reset,
    },
  };
}
