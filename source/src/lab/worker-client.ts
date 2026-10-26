import { BatchRunner } from './batch';
import type { BatchSnapshot, ExperimentManifest } from './model';
import type { WorkerRequest, WorkerResponse } from './worker';
export class WorkerClient {
    private worker: Worker | null = null;
    private snapshot: BatchSnapshot | null = null;
    start(manifest: ExperimentManifest, update: (s: BatchSnapshot) => void, error: (message: string) => void, previous?: BatchSnapshot) {
        this.dispose();
        this.snapshot = previous ?? new BatchRunner(manifest).snapshot;
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            if (event.data.type === 'error') {
                error(event.data.message);
                return;
            }
            const old = this.snapshot!;
            const delta = new Map(event.data.records.map((r) => [`${r.variantId}|${r.policy}|${r.seed}`, r]));
            this.snapshot = { manifest, status: event.data.status, records: old.records.map((r) => delta.get(`${r.variantId}|${r.policy}|${r.seed}`) ?? r) };
            update(this.snapshot);
        };
        this.worker.onerror = () => error('后台任务异常，请保留记录并重载恢复');
        this.send({ type: 'start', manifest, previous });
    }
    private send(message: WorkerRequest) { this.worker?.postMessage(message); }
    pause() { this.send({ type: 'pause' }); }
    stop() { this.send({ type: 'stop' }); }
    dispose() { this.worker?.terminate(); this.worker = null; }
}
