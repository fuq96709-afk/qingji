import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { parsePaymentNotice, mergeCapturedDrafts } from '../src/paymentNotices.ts';
const realRequire=createRequire(import.meta.url);
const raw={id:'notice-'+'b'.repeat(64),packageName:'com.tencent.mm',title:'微信支付',text:'支付成功32元',postedAt:new Date(2026,9,15,12).getTime()};

function bridgeHarness(platform='android',value={enabled:true,granted:true,dropped:0,pending:[raw]},failures={}){
  let acknowledged=[],enabled=[],opened=0,screenEnabled=[],screenOpened=0,removed=0,required=0;
  const native={
    getStateAsync:async()=>JSON.stringify(value),
    acknowledgeAsync:async ids=>{acknowledged.push(...ids);},
    setEnabledAsync:async flag=>{enabled.push(flag);},
    openSettingsAsync:async()=>{opened++;},
    setScreenEnabledAsync:async flag=>{screenEnabled.push(flag);},
    openScreenSettingsAsync:async()=>{screenOpened++;},
    addListener:()=>{if(failures.subscribe)throw new Error('模拟订阅异常');return {remove(){removed++;if(failures.remove)throw new Error('模拟移除异常');}};}
  };
  const mocks={expo:{requireOptionalNativeModule(){required++;if(failures.module)throw new Error('模拟模块加载异常');return native;}},'react-native':{Platform:{OS:platform}},'./paymentNotices':{parsePaymentNotice,mergeCapturedDrafts}};
  const source=ts.transpileModule(readFileSync(new URL('../src/paymentNotifications.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>mocks[name]||realRequire(name)});
  return {api:module.exports.paymentNotifications,get acknowledged(){return acknowledged;},get enabled(){return enabled;},get opened(){return opened;},get screenEnabled(){return screenEnabled;},get screenOpened(){return screenOpened;},get removed(){return removed;},get required(){return required;}};
}
test('原生读取只返回可确认草稿，忽略无金额记录，开启必须进入系统授权页',async()=>{
  const h=bridgeHarness('android',{enabled:false,granted:false,dropped:0,pending:[raw,{...raw,id:'notice-'+'c'.repeat(64),text:'支付成功'}]});
  const state=await h.api.read();assert.equal(state.drafts.length,1);assert.equal(state.drafts[0].cents,3200);assert.deepEqual(h.acknowledged,['notice-'+'c'.repeat(64)]);
  await h.api.enable();assert.deepEqual(h.enabled,[true]);assert.equal(h.opened,1);
  await h.api.disable();assert.deepEqual(h.enabled,[true,false]);
  const unsubscribe=h.api.subscribe(()=>{});unsubscribe();assert.equal(h.removed,1);
});
test('网页和苹果不会请求安卓模块或伪造识别状态，损坏队列明确报错',async()=>{
  for(const platform of ['web','ios']){
    const h=bridgeHarness(platform);assert.equal((await h.api.read()).available,false);assert.equal(h.required,0);
    await assert.rejects(()=>h.api.enable(),/安卓安装版/);assert.equal(h.opened,0);
  }
  await assert.rejects(()=>bridgeHarness('android',{pending:'broken'}).api.read(),/读取失败/);
  await assert.rejects(()=>bridgeHarness('android',null).api.read(),/读取失败/);
});

test('页面与通知的开关、授权互相独立，撤销不会伪造开启状态',async()=>{
  const h=bridgeHarness('android',{enabled:false,granted:false,screenEnabled:true,screenGranted:false,pending:[]});
  const state=await h.api.read();assert.equal(state.screenEnabled,true);assert.equal(state.screenGranted,false);assert.equal(state.enabled,false);
  await h.api.enableScreens();assert.deepEqual(h.screenEnabled,[true]);assert.equal(h.screenOpened,1);assert.equal(h.opened,0);assert.equal(h.enabled.length,0);
  await h.api.disableScreens();assert.deepEqual(h.screenEnabled,[true,false]);
  await h.api.dismissMany(['one','two']);assert.deepEqual(h.acknowledged,['one','two']);
  await assert.rejects(()=>bridgeHarness('web').api.enableScreens(),/安卓安装版/);
});
test('同交易多通道合成一笔；无效来源只确认原始ID，不删除有效页面',async()=>{
  const captureId='notice-'+'f'.repeat(64),transactionRef='20261016000001';
  const h=bridgeHarness('android',{enabled:true,granted:true,pending:[
    {...raw,captureId,transactionRef,text:'支付成功32元\n交易单号：'+transactionRef},
    {...raw,id:'notice-'+'d'.repeat(64),channel:'screen',title:'支付成功页面',captureId,transactionRef,text:'支付成功\n￥32.00\n交易单号：'+transactionRef+'\n完成'},
    {...raw,id:'notice-'+'e'.repeat(64),captureId,transactionRef,text:'支付成功'}
  ]});
  const state=await h.api.read();assert.equal(state.drafts.length,1);assert.equal(state.drafts[0].id,captureId);assert.deepEqual(h.acknowledged,['notice-'+'e'.repeat(64)]);
});

test('安卓识别模块加载失败不阻止应用导入，错误只留在识别入口',async()=>{
  const h=bridgeHarness('android',undefined,{module:true});
  await assert.rejects(()=>h.api.read(),/手动记账不受影响/);
  assert.doesNotThrow(()=>h.api.subscribe(()=>{})());assert.equal(h.enabled.length,0);
});
test('订阅失败可提示和重读，清理失败也不打断页面关闭',async()=>{
  const h=bridgeHarness('android',undefined,{subscribe:true});let error;
  const close=h.api.subscribe(()=>{},value=>{error=value;});assert.match(error.message,/订阅异常/);assert.doesNotThrow(close);
  assert.equal((await h.api.read()).drafts.length,1);
  const cleanup=bridgeHarness('android',undefined,{remove:true});assert.doesNotThrow(()=>cleanup.api.subscribe(()=>{})());
});
