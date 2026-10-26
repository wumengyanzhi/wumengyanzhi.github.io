import { clone, fingerprint,canonical } from './config-snapshot';
import { LabEngine } from './engine-adapter';
import type { FrozenVariant, RunRecord } from './model';
import type { GameState } from '@domain/state/game-state';
export async function replayAt(variant: FrozenVariant, record: Pick<RunRecord, 'frames' | 'checkpoints'> & Partial<Pick<RunRecord,'quality'>>, afterFrames: number): Promise<GameState | null> {
    if (!Number.isInteger(afterFrames) || afterFrames < 0 || afterFrames > record.frames.length)
        throw new Error('回放位置越界');
    const checkpoint = [...record.checkpoints].reverse().find((c) => c.afterFrames <= afterFrames);
    if (checkpoint && await fingerprint(checkpoint.state) !== checkpoint.hash)
        throw new Error('检查点散列不一致');
    const engine = new LabEngine(variant, checkpoint?.state);
    for (let i = checkpoint?.afterFrames ?? 0; i < afterFrames; i++) {
        const frame = record.frames[i]!;
        const before=engine.state;
        if(frame.goldBefore!==(before?.run.gold??engine.config.economy.initialGold)||frame.rngBefore!==(before?.rng.cursor??0)||frame.enemyHpBefore!==(before?.battle?.enemyCurrentHp??null)||frame.battleIndex!==(before?.run.battlesWon??0)+1)throw new Error(`第 ${i+1} 步资源或战次记录不一致`);
        if (await fingerprint(engine.state) !== frame.beforeHash)
            throw new Error(`第 ${i + 1} 步之前状态不一致`);
        const result = engine.dispatch(frame.command);
        if(frame.goldAfter!==result.state.run.gold||frame.rngAfter!==result.state.rng.cursor)throw new Error(`第 ${i+1} 步提交资源记录不一致`);
        if(record.quality!=='trace_incomplete'&&canonical(result.trace)!==canonical(frame.trace))throw new Error(`第 ${i+1} 步结算明细不一致`);
        if(canonical(result.events)!==canonical(frame.events))throw new Error(`第 ${i+1} 步领域事件不一致`);
        if (await fingerprint(result.state) !== frame.afterHash)
            throw new Error(`第 ${i + 1} 步之后状态不一致`);
    }
    return clone(engine.state);
}
export function firstDivergence(a: RunRecord, b: RunRecord): number | null {
    const n = Math.max(a.frames.length, b.frames.length);
    for (let i = 0; i < n; i++)
        if (JSON.stringify(a.frames[i]?.command) !== JSON.stringify(b.frames[i]?.command) || a.frames[i]?.afterHash !== b.frames[i]?.afterHash)
            return i;
    return null;
}
