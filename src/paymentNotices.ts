import { parseAmount, validDate } from './ledger.ts';

export type CaptureChannel='notification'|'screen';
export type DetectedExpense = { id:string; cents:number; date:string; note:string; source:string; text:string; channel?:CaptureChannel; postedAt?:number; possibleDuplicate?:boolean; amountOptions?:number[] };
export type PaymentNotice = { id:string; packageName:string; title:string; text:string; postedAt:number; channel?:CaptureChannel; transactionRef?:string; captureId?:string };

// Notifications are hints for a draft, never proof that a transaction happened.
export function parsePaymentNotice(value:unknown):DetectedExpense|null {
  if(!value||typeof value!=='object')return null;
  const n=value as Partial<PaymentNotice>;
  if(typeof n.id!=='string'||!/^notice-[a-f0-9]{64}$/.test(n.id)||typeof n.title!=='string'||typeof n.text!=='string'||n.title.length>200||n.text.length>2048||typeof n.postedAt!=='number'||!Number.isSafeInteger(n.postedAt)||n.postedAt<=0)return null;
  const source=n.packageName==='com.tencent.mm'?'微信':n.packageName==='com.eg.android.AlipayGphone'?'支付宝':null;
  if(!source||!(n.channel===undefined||n.channel==='notification'||n.channel==='screen'))return null;
  if(n.channel==='screen')return parsePaymentScreen(n as PaymentNotice,source);
  if(source==='微信'&&!/^(微信支付|微信支付凭证|微信支付通知|支付凭证)$/.test(n.title.trim()))return null;
  const text=(n.title+'\n'+n.text).normalize('NFKC');
  if(/退款|退回|撤销|失败|未支付|待支付|待付款|取消|转账|收款成功|到账|收入|红包|验证码|验证代码|付款码|支付请求|付款请求|请求付款|支付提醒|优惠券/.test(text))return null;
  if(/美元|港元|港币|日元|日币|欧元|英镑|澳元|加元|新加坡元|\b(?:USD|HKD|JPY|EUR|GBP|AUD|CAD|SGD)\b/i.test(text))return null;
  if(/(?:[¥￥]\s*[-−]\s*\d|[-−]\s*[¥￥]?\s*\d+(?:\.\d+)?\s*元)/.test(text))return null;
  if(!/支付成功|付款成功|消费成功|扣款成功|成功支付|成功付款|成功消费|成功扣款|支付金额|付款金额|消费金额|实付金额|扣款金额|微信支付凭证/.test(text))return null;
  const amounts=new Set<number>();
  const number='((?:\\d{1,3}(?:,\\d{3})+|\\d{1,9})(?:\\.\\d{1,2})?)(?![\\d.,])';
  const patterns=[
    new RegExp('(?:支付金额|付款金额|消费金额|实付金额|扣款金额|成功支付|成功付款|成功消费|成功扣款|支付成功|付款成功|消费成功|扣款成功|金额|支付|付款|消费|扣款)[\\s:：]*[¥￥]?\\s*'+number+'\\s*(?:元|(?=\\s|$))','g'),
    new RegExp('[¥￥]\\s*'+number,'g'),
    new RegExp('(?:^|[^\\d.,])'+number+'\\s*元','g')
  ];
  try{for(const pattern of patterns)for(const match of text.matchAll(pattern))amounts.add(parseAmount(match[1].replaceAll(',','')));}catch{return null;}
  if(amounts.size!==1)return null;
  return draftFromCapture(n as PaymentNotice,[...amounts][0],source);
}


const referencePattern=/(?:交易单号|交易订单号|交易号)[：:\s]+([A-Za-z0-9_-]{8,64})(?![A-Za-z0-9_-])/;
function draftFromCapture(n:PaymentNotice,cents:number,source:string):DetectedExpense|null {
  const time=new Date(n.postedAt);
  const date=[time.getFullYear(),String(time.getMonth()+1).padStart(2,'0'),String(time.getDate()).padStart(2,'0')].join('-');
  if(!validDate(date))return null;
  const lines=n.text.normalize('NFKC').split('\n').map(line=>line.trim()).filter(Boolean);
  const label=/^(?:商户名称|商户全称|商家名称|商家|收款方|交易对象)[：:]?\s*(.*)$/;
  let note='';
  for(let i=0;i<lines.length;i++){
    const found=lines[i].match(label);if(!found)continue;
    const value=found[1]||lines[i+1]||'';
    if(value.length<=80&&!/^(?:[¥￥\d]|交易|订单|支付|付款|完成|返回)/.test(value)){note=value;break;}
  }
  const ref=n.text.normalize('NFKC').match(referencePattern)?.[1];
  const id=ref&&n.transactionRef===ref&&typeof n.captureId==='string'&&/^notice-[a-f0-9]{64}$/.test(n.captureId)?n.captureId:n.id;
  return {id,cents,date,note,source,text:n.title+'\n'+n.text,channel:n.channel||'notification',postedAt:n.postedAt};
}

function parsePaymentScreen(n:PaymentNotice,source:string):DetectedExpense|null {
  const text=n.text.normalize('NFKC');
  const lines=text.split('\n').map(line=>line.trim()).filter(Boolean);
  if(n.title!=='支付成功页面'||lines.length<3||!lines.some(line=>['完成','回首页','返回商家'].includes(line)))return null;
  if(/退款|退回|撤销|失败|未支付|待支付|待付款|取消支付|转账|收款成功|到账|验证码|密码|支付请求|付款请求|美元|港元|港币|日元|欧元|英镑|澳元|\b(?:USD|HKD|JPY|EUR|GBP|AUD|CAD|SGD)\b/i.test(text))return null;
  const number='((?:\\d{1,3}(?:,\\d{3})+|\\d{1,8})(?:\\.\\d{1,2})?)';
  const anchor=new RegExp('^(?:支付成功|付款成功|扣款成功)(?:[：:\\s]*[¥￥]?\\s*'+number+'\\s*元?)?$');
  const anchors=lines.slice(0,4).map(line=>line.match(anchor)).filter(value=>value!==null);
  if(!anchors.length)return null;
  const paid=new Set<number>();
  const parse=(value:string)=>parseAmount(value.replaceAll(',',''));
  const amountLine=new RegExp('^[¥￥]?\\s*'+number+'\\s*元?$');
  const currencyLine=new RegExp('^(?:[¥￥]\\s*'+number+'|'+number+'\\s*元)$');
  const paidLine=new RegExp('^(?:实付金额|实付款|实际支付|实付|付款金额|支付金额|扣款金额)[：:\\s]*[¥￥]?\\s*'+number+'\\s*元?$');
  try{
    for(const match of anchors)if(match[1])paid.add(parse(match[1]));
    for(let i=0;i<lines.length;i++){
      const match=lines[i].match(paidLine);
      if(match)paid.add(parse(match[1]));
      else if(/^(?:实付金额|实付款|实际支付|实付|付款金额|支付金额|扣款金额)[：:]?$/.test(lines[i])){
        const next=lines[i+1]?.match(amountLine);if(!next)return null;paid.add(parse(next[1]));
      }
    }
    if(paid.size>1)return null;
    if(!paid.size)for(const line of lines){const match=line.match(currencyLine);if(match)paid.add(parse(match[1]||match[2]));}
  }catch{return null;}
  if(paid.size!==1)return null;
  return draftFromCapture(n,[...paid][0],source);
}

// Only a shared, native-verified transaction identity is merged. Equal amounts alone are hints.
export function mergeCapturedDrafts(drafts:DetectedExpense[]):DetectedExpense[] {
  const grouped=new Map<string,DetectedExpense>();
  for(const draft of drafts){
    const prior=grouped.get(draft.id);
    if(!prior){grouped.set(draft.id,draft);continue;}
    const amounts=[...new Set([...(prior.amountOptions||[prior.cents]),...(draft.amountOptions||[draft.cents])])];
    const preferred=draft.channel==='screen'?draft:prior;
    const times=[prior.postedAt,draft.postedAt].filter((time):time is number=>typeof time==='number'&&Number.isFinite(time));
    grouped.set(draft.id,{...preferred,note:preferred.note||prior.note||draft.note,cents:amounts.length===1?amounts[0]:0,...(amounts.length>1?{amountOptions:amounts}:{}),...(times.length?{postedAt:Math.min(...times)}:{})});
  }
  return [...grouped.values()];
}

export function flagPossibleDuplicates(drafts:DetectedExpense[],entries:{id:string;date:string;cents:number;kind:string}[]):DetectedExpense[] {
  return drafts.map(draft=>({...draft,possibleDuplicate:draft.cents>0&&(
    entries.some(entry=>entry.id!==draft.id&&entry.kind==='expense'&&entry.date===draft.date&&entry.cents===draft.cents)||
    drafts.some(other=>other.id!==draft.id&&other.source===draft.source&&other.cents===draft.cents&&other.channel!==draft.channel&&Math.abs((other.postedAt||0)-(draft.postedAt||0))<=120000)
  )}));
}
