import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { createConfigRegistry } from '@config/config-registry';
import { freezeVariant } from '../../lab/config-snapshot';
import { SandboxPage } from '../../lab/ui/sandbox-page';
import { ParameterPage } from '../../lab/ui/parameter-page';
import { ReportPage } from '../../lab/ui/report-page';
import { createManifest } from '../../lab/capabilities';
import { BatchRunner } from '../../lab/batch';
import { webcrypto } from 'node:crypto';
beforeAll(()=>{vi.stubGlobal('crypto',webcrypto);});
afterAll(()=>vi.unstubAllGlobals());

const loaded=createConfigRegistry();if(!loaded.ok)throw new Error('配置无效');const base=loaded.value.config;
afterEach(cleanup);
describe('实验室主路径',()=>{
  it('手工修改军势时标为人工场景，保存不冒充自然对局',async()=>{
    const variant=await freezeVariant(base,{},'基线');let source='';
    render(<SandboxPage variant={variant} onScenario={(s)=>{source=s.source;}} onReplay={()=>{}} onError={()=>{}}/>);
    await waitFor(()=>expect(screen.getAllByRole('button',{name:/^手牌/})).toHaveLength(8));
    fireEvent.change(screen.getByLabelText('军势总点数'),{target:{value:'3'}});
    fireEvent.click(screen.getByRole('button',{name:'应用人工场景'}));
    await waitFor(()=>expect(screen.getByText('军势 3')).toBeTruthy());
    fireEvent.click(screen.getByRole('button',{name:'保存检查点'}));
    expect(source).toBe('fixture');
  });
  it('手牌点击排阵后可预览并执行真实一手',async()=>{
    const variant=await freezeVariant(base,{},'基线');
    render(<SandboxPage variant={variant} onScenario={()=>{}} onReplay={()=>{}} onError={()=>{}} />);
    await waitFor(()=>expect(screen.getAllByRole('button',{name:/^手牌/})).toHaveLength(8));
    fireEvent.click(screen.getAllByRole('button',{name:/^手牌/})[0]!);
    fireEvent.click(screen.getByRole('button',{name:'格位 1：空'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'预览'})).not.toHaveProperty('disabled',true));
    fireEvent.click(screen.getByRole('button',{name:'预览'}));
    await waitFor(()=>expect(screen.getByText('预计伤害')).toBeTruthy());
    expect(screen.getByText('剩余出战 4')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'执行一手'}));
    await waitFor(()=>expect(screen.getByText('剩余出战 3')).toBeTruthy());
  });
  it('参数页可搜索首领并保存调整方案，原配置不变',async()=>{
    let saved=0;
    const variant=await freezeVariant(base,{},'基线');
    render(<ParameterPage variant={variant} onFreeze={()=>{saved++;}} onError={()=>{}} />);
    fireEvent.change(screen.getByLabelText('搜索参数'),{target:{value:'虎牢'}});
    fireEvent.change(screen.getByLabelText('虎牢魔将 · 最大生命'),{target:{value:'3200'}});
    fireEvent.click(screen.getByRole('button',{name:'保存冻结方案'}));
    await waitFor(()=>expect(saved).toBe(1));
    expect(base.enemies.get('three_kingdoms.enemy.hu_lao_mo_jiang')?.maxHp).toBe(3600);
  });
  it('没有正常样本时展示空态，不伪造零胜率',async()=>{
    const variant=await freezeVariant(base,{},'基线');
    const manifest=await createManifest({variants:[variant],policies:['legacy_match_v1'],seeds:['empty']});
    render(<ReportPage snapshot={new BatchRunner(manifest).snapshot} onReplay={()=>{}} />);
    expect(screen.getAllByText(/无适用样本|尚无正常/).length).toBeGreaterThan(0);
  });
});
