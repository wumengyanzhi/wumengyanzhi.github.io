import { useState } from 'react';
import type { CardDef } from '../model';

const characters = ['shu_zhong_meng_shi','shu_zhong_gong_shou','wei_ying_ce_shi','wei_ying_su_wei','jiang_dong_gong_shou','jiang_dong_ce_shi','qun_xiong_meng_shi','qun_xiong_jian_ke','shu_zhong_xiao_jiang','ba_shu_shen_she','shu_han_mi_shi','wei_wu_zhi_shi','hu_wei_su_jiang','wei_ying_mi_tan','jiang_dong_shen_she','jiang_dong_zhi_jiang','jiang_dong_tie_wei','xi_liang_xiao_jiang','luan_shi_jian_ke','sai_wai_shen_she','xia_hou_dun','zhao_yun','zhu_ge_liang','pang_tong','huang_zhong','sun_shang_xiang','guan_yu','cao_cao','zhou_yu','lv_bu'];
const objects = ['huan_shou_dao','chang_bing_tie_qiang','lie_gong','zhu_gu_yu_shan','xiu_jian','bai_lian_huan_shou_dao','bing_feng_zhan_ma_dao','yu_lin_chang_qiang','jun_shi_yu_shan','zhu_sha_fu_bi','lian_zhu_fei_shi','diao_ling_qiang_gong','you_qi_jiao_gong','yan_wei_xiu_biao','zhen_jun_yi_dao','zhui_feng_diao_gong','wu_xing_zhen_pan','bing_ren_qi_ju','qi_xie_bing_yong','jun_shi_ru_hong','chou_cuo_jun_liang','lei_gu_jin_jun','zuo_you_ce_ying','ji_zhao_yuan_jun','si_ji_er_dong','qing_zhuang_ji_xi','ben_zhi_xie_zhen','xu_shi_xiang_sheng','duan_liang_qi_xi','hou_jun_ya_zhen'];
const charms = ['cui_bing_fu','shuang_feng_jun_yin','lian_ce_jian','zhou_liu_chou','fu_ji_ling','zhe_jian_ling','wen_jun_gu','ju_shi_qi','cheng_shi_jing'];
const enemies = ['v2_huang_jin_san_zhen','v2_xi_liang_you_qi','v2_hu_ben_tie_wei','v2_jiang_dong_shui_zhai','v2_bai_gu_fang_shi','v2_hu_lao_mo_jiang'];
function Atlas({ file, index, columns, label, glyph, className = '' }: { file: string; index: number; columns: number; label: string; glyph: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const rows = 5;
  return <span className={`v2-art ${className}`} role="img" aria-label={label} style={{
    display: 'block', aspectRatio: '1', position: 'relative', overflow: 'hidden',
    backgroundColor: '#35281d', backgroundImage: failed || index < 0 ? undefined : `url(/art/${file}.png)`,
    backgroundSize: `${columns * 100}% ${rows * 100}%`,
    backgroundPosition: `${(index % columns) * 100 / (columns - 1)}% ${Math.floor(index / columns) * 100 / (rows - 1)}%`,
  }}>
    <img src={`/art/${file}.png`} onError={() => setFailed(true)} alt="" aria-hidden="true" style={{ display: 'none' }} />
    {(failed || index < 0) && <span style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: '2rem', color: '#ccb481' }}>{glyph}</span>}
  </span>;
}
export function CardArt({ definition, className }: { definition: CardDef; className?: string }) {
  const suffix = definition.id.split('.').at(-1) ?? '';
  const list = definition.type === 'character' ? characters : objects;
  return <Atlas file={definition.type === 'character' ? 'characters' : 'objects'} index={list.indexOf(suffix)} columns={6} label={`${definition.name}插画`} glyph={definition.glyph} className={className} />;
}
export function CharmArt({ charmId, className }: { charmId: string; className?: string }) {
  return <Atlas file="charms-enemies" index={charms.indexOf(charmId.split('.').at(-1) ?? '')} columns={3} label="锦囊插画" glyph="符" className={className} />;
}
export function EnemyArt({ enemyId, className }: { enemyId: string; className?: string }) {
  const suffix = enemyId.split('.').at(-1) ?? '';
  const campaign = /^campaign_([1-3])_([1-6])$/.exec(suffix);
  const index = campaign ? Number(campaign[2]) === 6 ? [2, 4, 5][Number(campaign[1]) - 1]! : [0, 1, 2][Number(campaign[1]) - 1]! : enemies.indexOf(suffix);
  return <Atlas file="charms-enemies" index={index < 0 ? -1 : index + 9} columns={3} label="敌军阵势插画" glyph="阵" className={className} />;
}
