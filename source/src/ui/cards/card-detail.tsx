import { Fragment, type ReactElement } from 'react';
import type { EffectConfig } from '@config/schemas/effect.schema';
import { CARD_TYPE_TEXT, RARITY_TEXT, type CardFace } from './card-face';
import { CardView } from './card-view';
import type { MatchLine } from './match-text';
import { Dialog } from '../battle/choice-dialog';
import { describeEffects } from './skill-text';

/**
 * 卡牌详情。
 *
 * 把四层数值的来源逐层摊开，玩家能看懂「这张牌现在为什么是这些数字」。
 * 四层数据与技能参数都来自 GameState 和配置，界面不复算。
 */

export interface EnhancementSkillText {
  readonly id: string;
  readonly name: string;
  readonly text: string;
}

export interface CardDetailProps {
  readonly face: CardFace;
  /** 相性速查：兵器列职业、人物列兵器，档位与增幅读配置。 */
  readonly match: readonly MatchLine[];
  readonly effects: readonly EffectConfig[];
  readonly enhancementSkills: readonly EnhancementSkillText[];
  readonly moralePowerPerPoint: number;
  readonly statusLabel: string;
  readonly equippedToName: string | null;
  readonly onClose: () => void;
}

function Layer({ label, value }: { readonly label: string; readonly value: number }): ReactElement {
  return value === 0 ? <></> : (
    <>
      <dt>{label}</dt>
      <dd className="num">+{value}</dd>
    </>
  );
}

export function CardDetail({
  face,
  match,
  effects,
  enhancementSkills,
  moralePowerPerPoint,
  statusLabel,
  equippedToName,
  onClose,
}: CardDetailProps): ReactElement {
  const skills = describeEffects(effects);
  const ownedSkills = enhancementSkills.filter((skill) => face.enhancementSkillIds.includes(skill.id));

  return (
    <Dialog title={face.name} subtitle={`${CARD_TYPE_TEXT[face.cardType]} · ${RARITY_TEXT[face.rarity]} · ${statusLabel}`} onClose={onClose}>
      <div className="detail-grid">
        <CardView face={face} variant="detail" match={match} />

        <div className="detail-rows">
          {match.length > 0 && (
            <section>
              <h3 className="detail-block-title">
                {face.cardType === 'weapon' ? '相性 · 谁来用最合适' : '相性 · 配什么兵器最合适'}
              </h3>
              <dl className="stat-layer">
                {match.map((line) => (
                  <Fragment key={line.relation}>
                    <dt>{line.label}</dt>
                    <dd>
                      {line.names}
                      <span className="num"> +{line.ampBonus}</span>
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          )}

          <section>
            <h3 className="detail-block-title">当前数值</h3>
            <dl className="stat-layer">
              <dt>威力合计</dt>
              <dd className="num">{face.power}</dd>
              <dt>增幅合计</dt>
              <dd className="num">{face.amp}</dd>
            </dl>
            <dl className="stat-layer">
              <dt>基础威力</dt>
              <dd className="num">{face.basePower}</dd>
              <dt>基础增幅</dt>
              <dd className="num">{face.baseAmp}</dd>
              <Layer label="本局永久威力" value={face.permanentPower} />
              <Layer label="本局永久增幅" value={face.permanentAmp} />
              <Layer label="本场临时威力" value={face.battleTemporaryPower} />
              <Layer label="本场临时增幅" value={face.battleTemporaryAmp} />
              <Layer label="本次出战威力" value={face.thisPlayPower} />
              <Layer label="本次出战增幅" value={face.thisPlayAmp} />
            </dl>
          </section>

          <section>
            <h3 className="detail-block-title">军势</h3>
            <p className="preview__empty">
              本场累积 {face.morale} 点，每点提供 {moralePowerPerPoint} 点威力，战斗结束清零。
            </p>
          </section>

          {equippedToName !== null && (
            <section>
              <h3 className="detail-block-title">配属</h3>
              <p className="preview__empty">
                本次出战中归属于 <strong>{equippedToName}</strong>
                {face.weaponClass === null ? '' : '，匹配档位以出牌框上的连营线标注为准'}。
              </p>
            </section>
          )}

          {skills.length > 0 && (
            <section>
              <h3 className="detail-block-title">卡牌技能</h3>
              <ul className="skill-list">
                {skills.map((skill, index) => (
                  <li key={index}>
                    <strong>{skill.title}</strong>
                    {skill.body}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {ownedSkills.length > 0 && (
            <section>
              <h3 className="detail-block-title">战后强化附加技能</h3>
              <ul className="skill-list">
                {ownedSkills.map((skill) => (
                  <li key={skill.id}>
                    <strong>{skill.name}</strong>
                    {skill.text}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {skills.length === 0 && ownedSkills.length === 0 && (
            <section>
              <h3 className="detail-block-title">技能</h3>
              <p className="preview__empty">这张牌没有技能，它的价值全部体现在基础数值与相邻组合上。</p>
            </section>
          )}
        </div>
      </div>
    </Dialog>
  );
}

