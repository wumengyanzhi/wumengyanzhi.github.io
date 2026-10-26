import type { CardDef } from '../model';

/** Names are authored independently of rule text so the card face never truncates rules. */
export const CARD_SKILL_NAMES: Readonly<Record<string, string>> = {
  shu_zhong_xiao_jiang: '本职精通', ba_shu_shen_she: '本职精通', shu_han_mi_shi: '侧翼潜行',
  wei_wu_zhi_shi: '本职精通', hu_wei_su_jiang: '居中护阵', wei_ying_mi_tan: '留策观察',
  jiang_dong_shen_she: '侧阵射击', jiang_dong_zhi_jiang: '协策', jiang_dong_tie_wei: '本职精通',
  xi_liang_xiao_jiang: '轻骑突袭', luan_shi_jian_ke: '本职精通', sai_wai_shen_she: '伺机齐射',
  xia_hou_dun: '砺兵', zhao_yun: '双锋破阵', zhu_ge_liang: '神机演算', pang_tong: '连环奇谋',
  huang_zhong: '精准射击', sun_shang_xiang: '弓腰姬', guan_yu: '淬武成势', cao_cao: '魏武同进',
  zhou_yu: '吴将聚势', lv_bu: '吞噬',
  bai_lian_huan_shou_dao: '本职配合', bing_feng_zhan_ma_dao: '双兵并进', yu_lin_chang_qiang: '本职配合',
  jun_shi_yu_shan: '本职配合', zhu_sha_fu_bi: '借策生势', lian_zhu_fei_shi: '两面夹击',
  diao_ling_qiang_gong: '本职配合', you_qi_jiao_gong: '临边开弓', yan_wei_xiu_biao: '本职配合',
  zhen_jun_yi_dao: '百战淬锋', zhui_feng_diao_gong: '弃阵追风', wu_xing_zhen_pan: '聚策成阵',
  bing_ren_qi_ju: '兵刃齐举', qi_xie_bing_yong: '器械并用', jun_shi_ru_hong: '军势如虹',
  chou_cuo_jun_liang: '筹措军粮', lei_gu_jin_jun: '擂鼓进军', zuo_you_ce_ying: '左右策应',
  ji_zhao_yuan_jun: '急召援军', si_ji_er_dong: '伺机而动', qing_zhuang_ji_xi: '轻装疾袭',
  ben_zhi_xie_zhen: '本职协阵', xu_shi_xiang_sheng: '虚实相生', duan_liang_qi_xi: '断粮奇袭', hou_jun_ya_zhen: '后军压阵',
};

const CARD_RULE_TEXT: Readonly<Record<string, string>> = {
  shu_zhong_xiao_jiang: '出战时，若装备至少一件本职兵器，自身本次威力 +15。',
  ba_shu_shen_she: '出战时，若装备至少一件本职兵器，自身本次威力 +15。',
  shu_han_mi_shi: '出战时，若位于第 1 或第 5 格，自身本次威力 +10。',
  wei_wu_zhi_shi: '出战时，若装备至少一件本职兵器，自身本次威力 +15。',
  hu_wei_su_jiang: '出战时，若左右两格均直接相邻另一名人物，自身本次威力 +20。',
  wei_ying_mi_tan: '出战时，若剩余手牌中有战术，自身本次威力 +15。',
  jiang_dong_shen_she: '出战时，若恰好只有一侧直接相邻卡牌，自身本次威力 +15。',
  jiang_dong_zhi_jiang: '出战时，若本次还有战术出战，自身本次威力 +15。',
  jiang_dong_tie_wei: '出战时，若装备至少一件本职兵器，自身本次威力 +15。',
  xi_liang_xiao_jiang: '出战时，若五格中恰好放了两张牌，自身本次威力 +20。',
  luan_shi_jian_ke: '出战时，若装备至少一件本职兵器，自身本次威力 +15。',
  sai_wai_shen_she: '出战时，若本场已主动弃牌至少一次，自身本次威力 +15。',
  xia_hou_dun: '每场限一次。结算后，若本次装备了兵器，自动强化其中职业加成最高的一件：本局永久威力 +10；同分选靠左的兵器。',
  zhao_yun: '每场限一次。出战时，若同时装备两件兵器，一件本次有效威力翻倍，另一件本次有效增幅翻倍。自动采用本次伤害较高的分配，同分时左侧兵器威力翻倍。',
  zhu_ge_liang: '每场限一次。结算后，若本次还有至少两张名称不同的战术出战，自身本局永久威力 +15。',
  pang_tong: '每场限一次。结算后，给本次出战的一张战术施加连环，并使其离场时回到手牌；手牌已满则进入弃牌堆。该实体本场下次成功出战时，原技能额外结算一次，随后移除连环；战后清除未用连环。只有一个目标时自动确定，多个目标时由你指定。',
  huang_zhong: '每场限一次。出战时，若本场已主动弃牌至少一次，自身本次威力 +25。',
  sun_shang_xiang: '每场限一次。出战时，可指定手牌中的一件兵器置入弃牌堆，将其基础威力与本局永久威力之和加入本次威力区；不指定则不消耗手牌。',
  guan_yu: '自身每累计获得 20 点本局永久威力，自身本局永久增幅 +1。',
  cao_cao: '自身在本局有效牌组中时，每当一张名称不是「曹操」的魏国人物被强化，自身本局永久威力 +10；战后卡牌强化也触发。',
  zhou_yu: '出战时，剩余手牌中每有一张吴国人物，自身本场临时威力 +20。',
  lv_bu: '每场限一次。主动出战时，若右侧直接相邻另一名人物，记录该人物及其基础威力与本局永久威力之和。战斗胜利时，若目标尚未进入本局移除区，将其吞噬并移入本局移除区，自身获得等同记录值的本局永久威力。',
  bai_lian_huan_shou_dao: '出战时，若配属武者，该人物本次威力 +10。',
  bing_feng_zhan_ma_dao: '出战时，若配属人物本次还装备了另一件兵器，自身本次增幅 +1。',
  yu_lin_chang_qiang: '出战时，若配属卫士，该人物本次威力 +10。',
  jun_shi_yu_shan: '出战时，若配属术士，该人物本次威力 +10。',
  zhu_sha_fu_bi: '出战时，若本次还有战术出战，自身本次增幅 +1。',
  lian_zhu_fei_shi: '出战时，若左右两格均直接相邻人物，自身本次增幅 +1。',
  diao_ling_qiang_gong: '出战时，若配属射手，该人物本次威力 +10。',
  you_qi_jiao_gong: '出战时，若配属人物位于第 1 或第 5 格，自身本次威力 +15。',
  yan_wei_xiu_biao: '出战时，若配属暗客，该人物本次威力 +10。',
  zhen_jun_yi_dao: '每场限一次，本局最多三次。结算后，若本次配属武者，自身本局永久威力 +10。',
  zhui_feng_diao_gong: '出战时，本场每主动弃牌一次，自身本次威力 +15，最多 +45。',
  wu_xing_zhen_pan: '出战时，本次每有一张战术出战，自身本次增幅 +1，最多 +3。',
  bing_ren_qi_ju: '出战时，本次每有一件兵器出战，本次威力区 +10，最多 +30。',
  qi_xie_bing_yong: '出战时，若本次有至少两种分类的兵器出战，本次增幅区 +2。',
  jun_shi_ru_hong: '出战时，每有 1 点当前军势，本次威力区 +5，最多 +25。',
  chou_cuo_jun_liang: '结算后，若本次出战含人物、兵器、战术三种类型，获得 1 金币。',
  lei_gu_jin_jun: '出战时，本次每有一名人物出战，本次威力区 +5，最多 +20。',
  zuo_you_ce_ying: '出战时，若左右两格均直接相邻人物，本次增幅区 +2。',
  ji_zhao_yuan_jun: '结算后，从抽牌堆随机抽取一张人物加入手牌，然后洗混抽牌堆。',
  si_ji_er_dong: '出战时，若本场已主动弃牌至少一次，本次增幅区 +2。',
  qing_zhuang_ji_xi: '出战时，若本次除自身外恰好只有一张牌出战，本次威力区 +25。',
  ben_zhi_xie_zhen: '出战时，本次每有一组人物实际装备其本职兵器，本次增幅区 +2，最多 +6。',
  xu_shi_xiang_sheng: '出战时，本次每有一张其他威力型战术出战，本次增幅区 +2，最多 +4。',
  duan_liang_qi_xi: '出战时，本场主动弃掉的牌每涉及一种不同类型，本次威力区 +15，最多 +45。',
  hou_jun_ya_zhen: '出战时，剩余手牌中每有一张人物，本次增幅区 +1，最多 +4。',
};

export const AUTOMATIC_EQUIPMENT_TEXT = '兵器自动配属左右直接相邻的人物，优先职业加成较高者，同分优先左侧，不跨空格。一名人物可同时装备左右两件兵器；无相邻人物时，兵器仍提供自身威力与增幅，不获得职业装备加成。';

export function getCardSkillName(definition: CardDef): string {
  return definition.skill ? CARD_SKILL_NAMES[definition.skill] ?? '' : '';
}

export function getCardRuleText(definition: CardDef): string {
  return definition.skill ? CARD_RULE_TEXT[definition.skill] ?? definition.text : '';
}
