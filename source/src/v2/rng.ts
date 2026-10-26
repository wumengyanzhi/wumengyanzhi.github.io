import type { RngStream, RunState } from './model';
export function seedHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0 || 1;
}
/** Four explicit streams are saved with the run; no UI operation consumes them. */
export function random(state: RunState, stream: RngStream): number {
  let value = state.rng[stream] >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  state.rng[stream] = value >>> 0 || 1;
  return state.rng[stream] / 4294967296;
}
export function shuffle<T>(state: RunState, stream: RngStream, input: readonly T[]): T[] {
  const values = [...input];
  for (let i = values.length - 1; i > 0; i--) { const j = Math.floor(random(state, stream) * (i + 1)); [values[i], values[j]] = [values[j]!, values[i]!]; }
  return values;
}
export function sample<T>(state: RunState, stream: RngStream, input: readonly T[], count: number): T[] { return shuffle(state, stream, input).slice(0, count); }
