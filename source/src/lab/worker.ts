import { BatchRunner } from './batch';
import { createSystemClock } from '@infra/clock/system-clock';
import type { BatchSnapshot, ExperimentManifest, RunRecord } from './model';
export type WorkerRequest = {
    type: 'start';
    manifest: ExperimentManifest;
    previous?: BatchSnapshot;
} | {
    type: 'pause';
} | {
    type: 'stop';
};
export type WorkerResponse = {
    type: 'update';
    status: BatchSnapshot['status'];
    records: readonly RunRecord[];
} | {
    type: 'error';
    message: string;
};
const scope = self as unknown as {
    onmessage: (event: MessageEvent<WorkerRequest>) => void;
    postMessage: (value: WorkerResponse) => void;
};
let batch: BatchRunner | null = null;
let busy = false;
scope.onmessage = (event) => {
    const message = event.data;
    if (message.type === 'pause') {
        batch?.pause();
        return;
    }
    if (message.type === 'stop') {
        batch?.stop();
        if(batch?.snapshot.status==='stopped')scope.postMessage({type:'update',status:'stopped',records:batch.snapshot.records});
        return;
    }
    if (busy) {
        scope.postMessage({ type: 'error', message: '已有运行中任务' });
        return;
    }
    batch = new BatchRunner(message.manifest, message.previous);
    busy = true;
    const clock = createSystemClock();
    let last = 0;
    const sent = new Map<string, RunRecord>();
    void batch.run((snapshot) => {
        if (clock.now() - last < 300 && snapshot.status === 'running')
            return;
        last = clock.now();
        const changed = snapshot.records.filter((r) => sent.get(`${r.variantId}|${r.policy}|${r.seed}`) !== r);
        changed.forEach((r) => sent.set(`${r.variantId}|${r.policy}|${r.seed}`, r));
        scope.postMessage({ type: 'update', status: snapshot.status, records: changed });
    }).catch((error) => scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })).finally(() => { busy = false; });
};
