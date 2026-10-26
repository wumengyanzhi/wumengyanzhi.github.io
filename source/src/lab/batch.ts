import { deepFreeze } from './config-snapshot';
import { createRun, type RunSession } from './runner';
import type { BatchSnapshot, ExperimentManifest, RunRecord } from './model';
export const yieldTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export function stopSnapshot(snapshot:BatchSnapshot):BatchSnapshot{
    if(snapshot.status==='stopped'||snapshot.status==='completed')return snapshot;
    return {...snapshot,status:'stopped',records:snapshot.records.map((r)=>['pending','running','paused'].includes(r.status)?{...r,status:'cancelled',outcome:undefined,reason:'用户停止'}:r)};
}
export class BatchRunner {
    private records: RunRecord[];
    private status: BatchSnapshot['status'];
    private requested: 'pause' | 'stop' | null = null;
    constructor(readonly manifest: ExperimentManifest, previous?: BatchSnapshot) {
        if (previous && previous.manifest.id !== manifest.id)
            throw new Error('批次身份不一致');
        this.status = previous?.status ?? 'paused';
        this.records = previous ? [...previous.records] : manifest.variants.flatMap((v) => manifest.policies.flatMap((policy) => manifest.seeds.map((seed) => ({ key: `${v.id}|${policy}|${seed}`, fingerprint: `${v.id}|${policy}|${seed}|${manifest.mode}`, variantId: v.id, policy, seed, attemptId: 1, status: 'pending' as const, quality: 'complete' as const, frames: [], checkpoints: [], pendingCommands: [], evaluations: 0 }))));
    }
    get snapshot(): BatchSnapshot { return deepFreeze({ manifest: this.manifest, status: this.status, records: [...this.records] }); }
    pause() { this.requested = 'pause'; }
    stop() {
        if(this.status==='paused'){
            const stopped=stopSnapshot(this.snapshot);this.status='stopped';this.records=[...stopped.records];
        }else this.requested='stop';
    }
    async run(notify: (snapshot: BatchSnapshot) => void, schedule: () => Promise<void> = yieldTask) {
        if (this.status === 'stopped' || this.status === 'completed')
            throw new Error('批次为终态，不能继续');
        this.status = 'running';
        this.requested = null;
        let active: RunSession | undefined;
        for (let i = 0; i < this.records.length; i++) {
            const record = this.records[i]!;
            if (!['pending', 'running', 'paused'].includes(record.status))
                continue;
            const variant = this.manifest.variants.find((v) => v.id === record.variantId)!;
            try{active = await createRun(this.manifest, variant, record.policy, record.seed, record.status === 'pending' ? undefined : record);}
            catch(error){this.records[i]={...record,status:'error',reason:error instanceof Error?error.message:String(error)};notify(this.snapshot);continue;}
            do {
                if (this.requested)
                    break;
                const more = await active.step();
                this.records[i] = active.record;
                notify(this.snapshot);
                if (!more)
                    break;
                await schedule();
            } while (true);
            if (this.requested) {
                if (this.requested === 'pause') {
                    active.pause();
                    this.records[i] = active.record;
                    this.status = 'paused';
                }
                else {
                    active.cancel();
                    this.records[i] = active.record;
                    this.records = this.records.map((r) => ['pending', 'running', 'paused'].includes(r.status) ? { ...r, status: 'cancelled', reason: '用户停止', outcome: undefined } : r);
                    this.status = 'stopped';
                }
                notify(this.snapshot);
                return;
            }
        }
        this.status = 'completed';
        notify(this.snapshot);
    }
}
