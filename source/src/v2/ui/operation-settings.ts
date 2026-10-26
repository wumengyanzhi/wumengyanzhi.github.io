export interface OperationSettings {
  dragEnabled: boolean;
  dragSensitivity: 'responsive' | 'balanced' | 'steady';
  touchHoldMs: 200 | 300 | 450;
  snapEnabled: boolean;
  dragPreview: boolean;
  doubleClickPlace: boolean;
}
export const DEFAULT_OPERATIONS: OperationSettings = {
  dragEnabled: true, dragSensitivity: 'balanced', touchHoldMs: 300,
  snapEnabled: true, dragPreview: true, doubleClickPlace: true,
};
export function normalizeOperations(input: unknown): OperationSettings {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const flag = (key: keyof OperationSettings) => typeof value[key] === 'boolean' ? value[key] as boolean : DEFAULT_OPERATIONS[key] as boolean;
  return {
    dragEnabled: flag('dragEnabled'), snapEnabled: flag('snapEnabled'), dragPreview: flag('dragPreview'), doubleClickPlace: flag('doubleClickPlace'),
    dragSensitivity: ['responsive', 'balanced', 'steady'].includes(String(value.dragSensitivity)) ? value.dragSensitivity as OperationSettings['dragSensitivity'] : 'balanced',
    touchHoldMs: value.touchHoldMs === 200 || value.touchHoldMs === 450 ? value.touchHoldMs : 300,
  };
}
