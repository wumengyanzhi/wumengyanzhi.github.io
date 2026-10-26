export interface TraceStep {
  readonly kind: 'power' | 'amp' | 'effect' | 'resource' | 'condition' | 'rejection';
  readonly source: string;
  readonly target?: string;
  readonly label: string;
  readonly timing: string;
  readonly before?: number;
  readonly after?: number;
  readonly detail?: string;
}
export interface TracePort { readonly write: (step: TraceStep) => void; readonly onError?: () => void }
/** 诊断失败不能反向改变领域结算。 */
export function emitTrace(port: TracePort | undefined, step: TraceStep): void {
  if (!port) return;
  try { port.write(step); } catch { try { port.onError?.(); } catch { /* 保持领域无副作用 */ } }
}
