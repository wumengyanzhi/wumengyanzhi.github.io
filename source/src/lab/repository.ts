import { clone } from './config-snapshot';
import type { BatchSnapshot, FrozenVariant, RunRecord, Scenario } from './model';
interface Entry {
    key: string;
    value: unknown;
}
export interface RepositoryBackend {
    get(key: string): Promise<unknown>;
    entries(prefix: string): Promise<Entry[]>;
    write(entries: Entry[]): Promise<void>;
}
export class MemoryBackend implements RepositoryBackend {
    private map = new Map<string, unknown>();
    async get(key: string) { return clone(this.map.get(key)); }
    async entries(prefix: string) { return [...this.map].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: clone(value) })); }
    async write(entries: Entry[]) { const next = new Map(this.map); entries.forEach((e) => next.set(e.key, clone(e.value))); this.map = next; }
}
export class IndexedBackend implements RepositoryBackend {
    private readonly ready: Promise<IDBDatabase>;
    constructor() { this.ready = new Promise((resolve, reject) => { const request = indexedDB.open('three-kingdoms-balance-lab', 1); request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'key' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('无法打开实验存储')); }); }
    async get(key: string) { const db = await this.ready; return new Promise<unknown>((resolve, reject) => { const req = db.transaction('entries').objectStore('entries').get(key); req.onsuccess = () => resolve((req.result as Entry | undefined)?.value); req.onerror = () => reject(req.error); }); }
    async entries(prefix: string) { const db = await this.ready; return new Promise<Entry[]>((resolve, reject) => { const req = db.transaction('entries').objectStore('entries').getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`)); req.onsuccess = () => resolve(req.result as Entry[]); req.onerror = () => reject(req.error); }); }
    async write(entries: Entry[]) { const db = await this.ready; return new Promise<void>((resolve, reject) => { const tx = db.transaction('entries', 'readwrite'); entries.forEach((e) => tx.objectStore('entries').put(e)); tx.oncomplete = () => resolve(); tx.onabort = () => reject(new Error('实验保存失败；旧记录仍保留')); tx.onerror = () => reject(tx.error); }); }
}
export class LabRepository {
    private cache = new Map<string, {
        ref: unknown;
        bytes: number;
    }>();
    constructor(private backend: RepositoryBackend = new IndexedBackend()) { }
    async saveVariant(variant: FrozenVariant) { await this.backend.write([{ key: `variant:${variant.id}`, value: variant }]); }
    async saveScenario(scenario: Scenario) { await this.backend.write([{ key: `scenario:${scenario.id}`, value: scenario }]); }
    async scenarios(): Promise<Scenario[]> { return (await this.backend.entries('scenario:')).map((e) => e.value as Scenario); }
    async variants(): Promise<FrozenVariant[]> { return (await this.backend.entries('variant:')).map((e) => e.value as FrozenVariant).sort((a, b) => a.name.localeCompare(b.name)); }
    async batches(): Promise<BatchSnapshot['manifest'][]> { return (await this.backend.entries('manifest:')).map((e) => e.value as BatchSnapshot['manifest']); }
    async saveBatch(snapshot: BatchSnapshot) {
        const prefix = `run:${snapshot.manifest.id}:`;
        if (![...this.cache.keys()].some((k) => k.startsWith(prefix))) {
            for (const e of await this.backend.entries(prefix))
                this.cache.set(e.key, { ref: null, bytes: new TextEncoder().encode(JSON.stringify(e.value)).length });
        }
        const changes: Entry[] = [];
        let size = 0;
        const nextCache = new Map(this.cache);
        for (const record of snapshot.records) {
            const key = `${prefix}${record.variantId}:${record.policy}:${record.seed}`, old = this.cache.get(key);
            let bytes = old?.bytes ?? 0;
            if (old?.ref !== record) {
                bytes = new TextEncoder().encode(JSON.stringify(record)).length;
                changes.push({ key, value: record });
                nextCache.set(key, { ref: record, bytes });
            }
            size += bytes;
        }
        size += new TextEncoder().encode(JSON.stringify(snapshot.manifest)).length;
        if (size > snapshot.manifest.budgets.storageBytes)
            throw new Error('实验存储额度不足，已暂停；请导出当前结果');
        changes.push({ key: `manifest:${snapshot.manifest.id}`, value: snapshot.manifest }, { key: `progress:${snapshot.manifest.id}`, value: snapshot.status });
        await this.backend.write(changes);
        this.cache = nextCache;
    }
    async loadBatch(id: string): Promise<BatchSnapshot> {
        const manifest = await this.backend.get(`manifest:${id}`) as BatchSnapshot['manifest'] | undefined;
        if (!manifest)
            throw new Error('实验记录不存在');
        const status = await this.backend.get(`progress:${id}`) as BatchSnapshot['status'];
        const records = (await this.backend.entries(`run:${id}:`)).map((e) => e.value as RunRecord);
        records.sort((a, b) => manifest.variants.findIndex((v) => v.id === a.variantId) - manifest.variants.findIndex((v) => v.id === b.variantId) || manifest.policies.indexOf(a.policy) - manifest.policies.indexOf(b.policy) || manifest.seeds.indexOf(a.seed) - manifest.seeds.indexOf(b.seed));
        return { manifest, status: status === 'running' ? 'paused' : status, records: records.map((r) => r.status === 'running' ? { ...r, status: 'paused' } : r) };
    }
}
