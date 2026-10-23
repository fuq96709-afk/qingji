import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parsePaymentNotice, mergeCapturedDrafts, flagPossibleDuplicates } from '../src/paymentNotices.ts';

const notice=(text,extra={})=>({id:'notice-'+'a'.repeat(64),packageName:'com.tencent.mm',title:'微信支付',text,postedAt:new Date(2026,9,15,12).getTime(),...extra});
test('仅从支持的支付通知生成草稿，金额精确到分，日期取本机日期',()=>{
  const draft=parsePaymentNotice(notice('支付成功 ￥32.00\n商户名称：测试餐厅'));
  assert.equal(draft.cents,3200);assert.equal(draft.date,'2026-10-15');assert.equal(draft.note,'测试餐厅');assert.equal(draft.source,'微信');
  assert.equal(parsePaymentNotice(notice('成功付款1,234.50元',{packageName:'com.eg.android.AlipayGphone',title:'支付宝'})).cents,123450);
  assert.equal(parsePaymentNotice(notice('支付金额：￥３２．５０',{title:'微信支付凭证'})).cents,3250);
});
test('聊天、其他应用、退款、转账、收款、验证码和营销不进入草稿',()=>{
  for(const text of ['退款成功32.00元','支付失败32.00元','转账成功，支付金额32.00元','收款成功，支付金额32.00元','支付成功32.00元，验证码123456','支付成功32.00元，领取优惠券','待付款32.00元','付款请求，支付金额32.00元'])assert.equal(parsePaymentNotice(notice(text)),null,text);
  assert.equal(parsePaymentNotice(notice('支付成功32.00元',{title:'某位朋友'})),null);
  assert.equal(parsePaymentNotice(notice('支付成功32.00元',{packageName:'other.app'})),null);
});
test('无金额、多个不同金额、零金额、错误金额、无效原生数据一律不推测',()=>{
  for(const text of ['支付成功','支付成功32.00元，账户余额100.00元','支付成功0元','支付成功32.001元','支付成功1,23.00元','支付成功-32元','支付成功￥32.00日元'])assert.equal(parsePaymentNotice(notice(text)),null,text);
  for(const value of [null,{},notice('支付成功32元',{id:'bad'}),notice('支付成功32元',{postedAt:NaN}),notice('支付成功32元',{text:'a'.repeat(2049)})])assert.equal(parsePaymentNotice(value),null);
  assert.equal(parsePaymentNotice(notice('支付成功32元\n支付金额：32.00元')).cents,3200);
});

const screen=(text,extra={})=>notice(text,{channel:'screen',title:'支付成功页面',...extra});
test('支付成功页提取实付金额，折扣与原价不替代实付，商户可跨行',()=>{
  const draft=parsePaymentNotice(screen('支付成功\n实付金额\n￥32.50\n订单金额：￥40.00\n优惠：￥7.50\n商户名称\n测试餐厅\n完成'));
  assert.equal(draft.cents,3250);assert.equal(draft.note,'测试餐厅');assert.equal(draft.channel,'screen');
  assert.equal(parsePaymentNotice(screen('付款成功 ￥12.34\n测试店\n完成')).cents,1234);
  assert.equal(parsePaymentNotice(screen('支付成功\n￥３２．５０\n完成')).cents,3250);
});
test('页面缺少成功锚点或完成按钮、多个金额、退款、密码或外币均不猜测',()=>{
  for(const text of ['￥32.00\n商户名称：测试店\n完成','支付成功\n￥32.00\n测试店','支付成功\n￥32.00\n￥50.00\n完成','支付成功\n实付金额32元\n支付金额40元\n完成','支付成功\n￥0\n完成','支付成功\n￥32.001\n完成','支付成功\n￥-32.00\n完成','支付成功\n￥32.00\n退款\n完成','支付成功\n￥32.00\n密码\n完成','支付成功\n￥32.00日元\n完成','聊天\n留言\n内容\n更多\n支付成功\n￥32.00\n完成'])assert.equal(parsePaymentNotice(screen(text)),null,text);
  assert.equal(parsePaymentNotice(screen('支付成功\n￥32.00\n完成',{title:'朋友'})),null);
  assert.equal(parsePaymentNotice(screen('支付成功\n￥32.00\n完成',{packageName:'other.app'})),null);
});
test('交易编号与原生身份一致才合并来源；编号不符保留原始身份',()=>{
  const captureId='notice-'+'c'.repeat(64),transactionRef='2026101600123456';
  const first=parsePaymentNotice(notice('支付成功32元\n交易单号：'+transactionRef,{captureId,transactionRef}));
  const second=parsePaymentNotice(screen('支付成功\n￥32.00\n交易单号：'+transactionRef+'\n完成',{id:'notice-'+'d'.repeat(64),captureId,transactionRef}));
  assert.equal(first.id,captureId);assert.equal(second.id,captureId);
  const merged=mergeCapturedDrafts([first,second]);assert.equal(merged.length,1);assert.equal(merged[0].cents,3200);assert.equal(merged[0].channel,'screen');
  assert.equal(parsePaymentNotice(notice('支付成功32元\n交易单号：'+transactionRef,{captureId,transactionRef:'wrong'})).id,notice('').id);
  assert.equal(parsePaymentNotice(notice('支付成功32元',{captureId,transactionRef})).id,notice('').id);
});
test('同金额无交易身份保留两笔，疑似重复仅提示；冲突金额必须重新输入',()=>{
  const first=parsePaymentNotice(notice('支付成功32元'));
  const second=parsePaymentNotice(screen('支付成功\n￥32.00\n完成',{id:'notice-'+'d'.repeat(64)}));
  const drafts=mergeCapturedDrafts([first,second]);assert.equal(drafts.length,2);
  assert.ok(flagPossibleDuplicates(drafts,[]).every(d=>d.possibleDuplicate));
  assert.equal(flagPossibleDuplicates([first],[{id:'manual',date:first.date,cents:3200,kind:'expense'}])[0].possibleDuplicate,true);
  assert.equal(flagPossibleDuplicates([first],[{id:'income',date:first.date,cents:3200,kind:'income'}])[0].possibleDuplicate,false);
  const conflict=mergeCapturedDrafts([first,{...second,id:first.id,cents:3100}]);
  assert.equal(conflict.length,1);assert.equal(conflict[0].cents,0);assert.deepEqual(conflict[0].amountOptions,[3200,3100]);
});
