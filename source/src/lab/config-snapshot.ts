import { buildEffectiveConfig, createConfigRegistry, type EffectiveConfig } from '@config/config-registry';
import { applyRuntimePatch, validateRuntimePatch } from '@config/runtime-patch';
import { validateBalance, validateContent, validatePresentation } from '@config/config-validator';
import type { ConfigSnapshot, FrozenVariant } from './model';
export function clone<T>(value: T): T { return structuredClone(value); }
export function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}
export function canonical(value: unknown): string {
    if (value === undefined)
        return 'null';
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export async function fingerprint(value: unknown): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
    return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
export function snapshotConfig(config: EffectiveConfig): ConfigSnapshot {
    // 初始牌库按注册顺序创建实例，数组顺序属于旧引擎的随机重放契约。
    return clone({ ...config, cards: [...config.cards.values()], enemies: [...config.enemies.values()], runs: [...config.runs.values()] });
}
export function restoreConfig(raw: ConfigSnapshot): EffectiveConfig {
    if (!raw || !Array.isArray(raw.cards) || !Array.isArray(raw.enemies) || !Array.isArray(raw.runs) || raw.runs.length !== 1)
        throw new Error('配置快照结构无效');
    const content = validateContent({ cards: raw.cards, enemies: raw.enemies, run: raw.runs[0], enhancement: raw.enhancement });
    const balance = validateBalance(raw);
    const presentation = validatePresentation(raw.presentation);
    if (!content.ok || !balance.ok || !presentation.ok)
        throw new Error('完整配置校验失败');
    const config = buildEffectiveConfig(content.value, balance.value, presentation.value.presentation);
    if (Object.values(config.enhancement.stageWeights).some((weights) => Object.values(weights).reduce((a, b) => a + b, 0) <= 0))
        throw new Error('奖励权重合计必须大于零');
    if (config.morale.noneMaxCharacterCount >= config.morale.formedMaxCharacterCount)
        throw new Error('军势档位门槛顺序无效');
    const known = createConfigRegistry();
    if (!known.ok)
        throw new Error('基础配置不可用');
    if (canonical([...config.cards.keys()]) !== canonical([...known.value.config.cards.keys()]))
        throw new Error('初始牌库顺序不匹配当前引擎版本');
    for (const card of config.cards.values()) {
        const original = known.value.config.cards.get(card.id);
        const structure = (c: typeof card) => Object.fromEntries(Object.entries(c).filter(([key]) => key !== 'basePower' && key !== 'baseAmp'));
        if (!original || canonical(structure(card)) !== canonical(structure(original)))
            throw new Error('卡牌机制或内容未接入');
    }
    if (canonical([...config.runs.values()]) !== canonical([...known.value.config.runs.values()]))
        throw new Error('流程机制未接入');
    if (config.contentVersion !== raw.contentVersion)
        throw new Error('内容版本未接入');
    if (config.battle.playSlotCount !== 5 || config.battle.handLimit !== 8 || config.cards.size !== 20 || config.runs.values().next().value?.nodes.filter((n) => n.type === 'battle').length !== 3)
        throw new Error('该内容超出三战原型能力，未接入');
    return config;
}
export async function freezeVariant(base: EffectiveConfig, raw: unknown, name: string): Promise<FrozenVariant> {
    if (!name.trim())
        throw new Error('请输入方案名称');
    const checked = validateRuntimePatch(raw);
    if (!checked.ok)
        throw new Error(checked.error.map((e) => `${e.path}：${e.message}`).join('\n'));
    const patch = checked.value;
    const numbers = (value: unknown): boolean => typeof value === 'number' ? Number.isSafeInteger(value) && value <= 1000000 : !value || typeof value !== 'object' || Object.values(value).every(numbers);
    if (!numbers(patch))
        throw new Error('数值必须为不超过 1,000,000 的安全整数');
    if (patch.presentation || patch.balance?.battle?.handLimit !== undefined || patch.balance?.battle?.playSlotCount !== undefined)
        throw new Error('本工具不改变表现、手牌容量或格位结构');
    const applied = applyRuntimePatch(base, patch);
    if (!applied.ok)
        throw new Error(applied.error.map((e) => `${e.path}：${e.message}`).join('\n'));
    const config = snapshotConfig(applied.value);
    restoreConfig(config);
    const hash = await fingerprint(config);
    return deepFreeze({ id: hash, name: name.trim(), hash, patch: clone(patch), config });
}
