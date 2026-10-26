import { z } from 'zod';

/**
 * 表现配置。
 *
 * 动画时长、吸附阈值、缩放与发光强度都是可调参数，因此进入配置而不是代码。
 * 关闭动画不得改变任何领域结果，只影响这些时长是否为 0。
 */
export const PresentationSchema = z.object({
  animation: z.object({
    enabled: z.boolean(),
    cardFlipMs: z.number().int().nonnegative(),
    damageTickMs: z.number().int().nonnegative(),
    cardMoveMs: z.number().int().nonnegative(),
    glowFadeMs: z.number().int().nonnegative(),
  }),
  drag: z.object({
    /** 超过该位移才算拖动，避免点击被识别为拖动。 */
    startThresholdPx: z.number().int().nonnegative(),
    /** 落点与目标区域中心的距离小于该值即吸附。 */
    snapDistancePx: z.number().int().nonnegative(),
  }),
  card: z.object({
    hoverScale: z.number().positive(),
    glowIntensity: z.number().nonnegative(),
  }),
});

export type PresentationConfig = z.infer<typeof PresentationSchema>;
