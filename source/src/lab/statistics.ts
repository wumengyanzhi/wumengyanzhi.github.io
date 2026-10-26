import { createSeededRng } from '@infra/rng/seeded-rng';
export function wilson(won: number, total: number): readonly [
    number,
    number
] | null {
    if (!total)
        return null;
    const z = 1.959963984540054, p = won / total, d = 1 + z * z / total;
    const center = (p + z * z / (2 * total)) / d;
    const radius = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / d;
    return [Math.max(0, center - radius), Math.min(1, center + radius)];
}
export function quantile(values: readonly number[], q: number): number | null {
    if (!values.length)
        return null;
    const a = [...values].sort((x, y) => x - y), index = (a.length - 1) * q, lo = Math.floor(index), hi = Math.ceil(index);
    return a[lo]! + (a[hi]! - a[lo]!) * (index - lo);
}
export function pairedBootstrap(differences: readonly number[], seed: string, iterations = 5000): readonly [
    number,
    number
] | null {
    if (differences.length < 2 || new Set(differences).size === 1)
        return null;
    const rng = createSeededRng();
    let state = rng.createState(seed);
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
        let sum = 0;
        for (let j = 0; j < differences.length; j++) {
            const roll = rng.nextInt(state, differences.length);
            state = roll.state;
            sum += differences[roll.value]!;
        }
        samples.push(sum / differences.length);
    }
    return [quantile(samples, .025)!, quantile(samples, .975)!];
}
