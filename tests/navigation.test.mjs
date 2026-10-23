import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as ledger from '../src/ledger.ts';
import { categoryIcons } from '../src/categoryIcons.ts';
import { flagPossibleDuplicates } from '../src/paymentNotices.ts';
import { mergeImport } from '../src/transfer.ts';
import { createLedgerStore, LEDGER_KEY, RECOVERY_KEY, LedgerReadError } from '../src/ledgerStore.ts';
const realRequire=createRequire(import.meta.url);
const entry=(id,date,cents)=>({id,date,cents,kind:'expense',category:'餐饮',note:'',version:1});
function appHarness(entries=[entry('this-year','2026-10-14',70590),entry('last-year','2025-10-14',1000)],{notifications={available:false,enabled:false,granted:false,dropped:0,drafts:[]},failSave=false,failDismiss=false,failRead=false}={}){
  const slots=[],alerts=[],data=new Map([[LEDGER_KEY,JSON.stringify(entries)]]);let cursor=0,writes=0,tree,dismissed=[];
  const store=createLedgerStore({getItem:async key=>data.get(key)??null,setItem:async(key,value)=>{if(key===LEDGER_KEY){writes++;if(failSave)throw new Error('模拟保存失败');}data.set(key,value);}});
  const mocks={
    react:{...realRequire('react'),useState(initial){const i=cursor++;if(!(i in slots))slots[i]=i===0?entries:i===1?false:initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useMemo:fn=>fn(),useEffect(){}},
    'react-native':{Platform:{OS:'android'},Alert:{alert(title,body,actions){alerts.push({title,body,actions});}},StyleSheet:{create:v=>v},...Object.fromEntries(['ActivityIndicator','Modal','Pressable','ScrollView','Text','View'].map(n=>[n,n]))},
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView',SafeAreaProvider:'SafeAreaProvider'},
    'expo-status-bar':{StatusBar:'StatusBar'},'expo-crypto':{randomUUID:()=> 'new-id'},
    './src/savedLedger':{savedLedger:store},'./src/ledgerStore':{LedgerReadError},'./src/paymentNotices':{flagPossibleDuplicates},
    './src/ledger':{...ledger,today:()=> '2026-10-14'},'./src/categoryIcons':{categoryIcons},'./src/transfer':{mergeImport},
    './src/Motion':{FadeView:'FadeView',useReducedMotion:()=>true},
    '@expo/vector-icons/MaterialCommunityIcons':{__esModule:true,default:'Icon'},'./src/DateWheel':{__esModule:true,default:'DateWheel'},
    './src/EntryEditor':{__esModule:true,default:'EntryEditor'},'./src/DataManager':{__esModule:true,default:'DataManager'},
    './src/NotificationInbox':{__esModule:true,default:'NotificationInbox'},
    './src/paymentNotifications':{emptyNotificationState:notifications,paymentNotifications:{read:async()=>{if(failRead)throw new Error('模拟识别读取异常');return {...notifications};},dismissMany:async ids=>{dismissed.push(...ids);if(failDismiss)throw new Error('模拟确认失败');notifications={...notifications,drafts:notifications.drafts.filter(d=>!ids.includes(d.id))};},subscribe:()=>()=>{},dismiss:async id=>{dismissed.push(id);if(failDismiss)throw new Error('模拟确认失败');notifications={...notifications,drafts:notifications.drafts.filter(d=>d.id!==id)};}}}
  };
  const source=ts.transpileModule(readFileSync(new URL('../App.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>mocks[name]||realRequire(name),Error});
  function render(){cursor=0;tree=module.exports.default();}
  function nodes(node,out=[]){
    if(!node)return out;if(Array.isArray(node)){node.forEach(n=>nodes(n,out));return out;}
    if(typeof node!=='object')return out;if(typeof node.type==='function')return nodes(node.type(node.props),out);
    out.push(node);nodes(node.props.children,out);return out;
  }
  function text(node){if(node==null||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(text).join('');if(typeof node==='string'||typeof node==='number')return String(node);return text(node.props?.children);}
  function get(label){const node=nodes(tree).find(n=>n.props.accessibilityLabel===label||n.type===label||(n.props.accessibilityRole==='button'&&text(n)===label));assert.ok(node,'missing '+label);return node.props;}
  function press(label){get(label).onPress();render();}
  render();return {get,press,render,alerts,data,setStored(records){data.set(LEDGER_KEY,JSON.stringify(records));},get dismissed(){return dismissed;},async flush(){await new Promise(setImmediate);render();},text:()=>text(tree),get writes(){return writes;},get stored(){return JSON.parse(data.get(LEDGER_KEY)||'[]');},async save(record){get('EntryEditor').onSave(record);await new Promise(setImmediate);render();}};
}
test('历史统计不会切换账本，重新打开统计回到当前日期',()=>{
  const h=appHarness();h.get('选择账本月份，当前2026年10月');assert.ok(h.text().includes('705.90'));
  h.press('统计');h.press('年度分类');h.press('上一年');assert.ok(h.text().includes('2025年'));
  h.press('账本');h.get('选择账本月份，当前2026年10月');h.get('2026-10-14');assert.ok(h.text().includes('705.90'));
  h.press('统计');assert.ok(h.text().includes('2026年'));h.press('周分类');h.get('2026-10-12至2026-10-18');
  assert.equal(h.writes,0);assert.equal(h.stored.length,2);
});
test('年月滚轮取消不改变账本，确认后独立保留月份',()=>{
  const h=appHarness();h.press('选择账本月份，当前2026年10月');
  assert.equal(h.get('DateWheel').mode,'month');h.get('DateWheel').onCancel();h.render();
  h.get('选择账本月份，当前2026年10月');
  h.press('选择账本月份，当前2026年10月');h.get('DateWheel').onConfirm('2026-09-01');h.render();
  h.get('选择账本月份，当前2026年9月');assert.ok(h.text().includes('2026年9月支出'));
  h.press('统计');h.press('年度分类');h.press('上一年');h.press('月度分类');h.press('上一个月');h.press('周分类');h.press('下一周');
  h.press('账本');h.get('选择账本月份，当前2026年9月');assert.equal(h.writes,0);
});
test('从历史统计保存账单后定位到记录月份，统计仍从当前年月打开',async()=>{
  const h=appHarness();h.press('统计');h.press('年度分类');h.press('上一年');h.press('＋ 记一笔');
  await h.save(entry('saved','2024-03-15',3200));
  h.get('选择账本月份，当前2024年3月');h.get('2024-03-15');assert.ok(h.text().includes('32.00'));
  assert.equal(h.writes,1);assert.equal(h.stored.length,3);
  h.press('统计');assert.ok(h.text().includes('2026年'));
  h.press('账本');h.get('选择账本月份，当前2024年3月');
});

test('账单标题优先显示备注，空备注使用分类，小字只显示消费类型',()=>{
  const h=appHarness([
    {...entry('noted','2026-10-14',2200),category:'购物',note:'  买了一双鞋  ',consumption:'emotional'},
    {...entry('blank','2026-10-14',800),note:'   '}
  ]);
  const noted=h.get('2026-10-14 买了一双鞋 · 购物 22.00元，点击编辑');
  const blank=h.get('2026-10-14 餐饮 8.00元，点击编辑');
  assert.equal(noted.children[1].props.children[0].props.children,'买了一双鞋');
  assert.equal(noted.children[1].props.children[1].props.children,'情绪消费');
  assert.equal(blank.children[1].props.children[0].props.children,'餐饮');
  assert.equal(blank.children[1].props.children[1],false);
  assert.equal(h.writes,0);assert.equal(h.stored[0].note,'  买了一双鞋  ');
});

const candidate={id:'notice-'+'a'.repeat(64),date:'2026-10-14',cents:3200,note:'午饭',source:'微信',text:'微信支付\n支付成功32.00元'};
const detectedState=()=>({available:true,enabled:true,granted:true,dropped:0,drafts:[candidate]});
test('通知草稿只在确认保存后入账，取消保留待确认，保存后不重复显示',async()=>{
  const h=appHarness([],{notifications:detectedState()});
  h.press('查看待确认消费');assert.equal(h.get('NotificationInbox').state.drafts.length,1);assert.equal(h.writes,0);
  h.get('NotificationInbox').onChoose(candidate);h.render();assert.equal(h.get('EntryEditor').entry,null);assert.equal(h.get('EntryEditor').initial.cents,3200);
  h.get('EntryEditor').onClose();h.render();h.press('查看待确认消费');assert.equal(h.get('NotificationInbox').state.drafts.length,1);assert.equal(h.writes,0);
  h.get('NotificationInbox').onChoose(candidate);h.render();
  await h.save({...entry(candidate.id,candidate.date,candidate.cents),note:candidate.note});
  assert.equal(h.stored.length,1);assert.equal(h.dismissed.length,1);
  h.press('统计');h.press('更多选项');h.press('消费识别');await h.flush();assert.equal(h.get('NotificationInbox').state.drafts.length,0);
});
test('通知草稿保存失败时不移除通知，确认通知失败也不重复入账',async()=>{
  const failed=appHarness([],{notifications:detectedState(),failSave:true});
  failed.press('查看待确认消费');failed.get('NotificationInbox').onChoose(candidate);failed.render();
  await failed.save(entry(candidate.id,candidate.date,candidate.cents));
  failed.get('EntryEditor');assert.equal(failed.stored.length,0);assert.equal(failed.dismissed.length,0);
  const committed=appHarness([],{notifications:detectedState(),failDismiss:true});
  committed.press('查看待确认消费');committed.get('NotificationInbox').onChoose(candidate);committed.render();
  await committed.save(entry(candidate.id,candidate.date,candidate.cents));
  assert.equal(committed.stored.length,1);committed.press('统计');committed.press('更多选项');committed.press('消费识别');await committed.flush();
  assert.equal(committed.get('NotificationInbox').state.drafts.length,0);
});

test('历史备注按收支和用途分组，每组最近优先、去重去空，最多八项',()=>{
  const entries=Array.from({length:10},(_,i)=>({...entry(String(i),'2026-10-14',100),note:'备注'+i}));
  entries.push({...entry('again','2026-10-14',100),note:'  备注2  '},{...entry('blank','2026-10-14',100),note:'  '});
  entries.push({...entry('study','2026-10-14',100),category:'学习',note:'买书'},{...entry('income','2026-10-14',100),kind:'income',category:'其他',note:'报销'});
  const h=appHarness(entries);h.press('＋ 记一笔');
  assert.deepEqual(Array.from(h.get('EntryEditor').noteHistory['expense:学习']),['买书']);
  assert.deepEqual(Array.from(h.get('EntryEditor').noteHistory['income:其他']),['报销']);
  assert.deepEqual(Array.from(h.get('EntryEditor').noteHistory['expense:餐饮']),['备注2','备注9','备注8','备注7','备注6','备注5','备注4','备注3']);
  assert.equal(h.writes,0);assert.equal(h.stored[10].note,'  备注2  ');
});

test('旧页面保存新账时保留已被其他页面写入的账单，编辑冲突则阻止覆盖',async()=>{
  const old=entry('old','2026-10-14',100),other=entry('other','2026-10-14',200),h=appHarness([old]);
  h.press('＋ 记一笔');h.setStored([old,other]);await h.save(entry('new','2026-10-14',300));
  assert.deepEqual(h.stored.map(e=>e.id),['old','other','new']);
  const edit=appHarness([old]);edit.press('2026-10-14 餐饮 1.00元，点击编辑');edit.setStored([{...old,cents:900}]);
  await edit.save({...old,cents:400});assert.equal(edit.stored[0].cents,900);assert.equal(edit.writes,0);edit.get('EntryEditor');
  assert.match(edit.alerts.at(-1).body,/其他页面更改/);
});
test('写入失败不显示成功，编辑和旧账都保留；损坏数据不会被空账覆盖',async()=>{
  const old=entry('old','2026-10-14',100),failed=appHarness([old],{failSave:true});
  failed.press('＋ 记一笔');await failed.save(entry('new','2026-10-14',300));
  failed.get('EntryEditor');assert.equal(failed.stored.length,1);assert.equal(failed.text().includes('已记下'),false);assert.equal(failed.alerts.at(-1).title,'未保存');
  const broken=appHarness([old]);broken.press('＋ 记一笔');broken.data.set(LEDGER_KEY,'broken');broken.data.set(RECOVERY_KEY,JSON.stringify([old]));
  await broken.save(entry('new','2026-10-14',300));assert.equal(broken.data.get(LEDGER_KEY),'broken');assert.equal(broken.writes,0);
  broken.get('EntryEditor').onClose();broken.render();broken.press('恢复本机副本');
  assert.match(broken.alerts.at(-1).body,/最近一次修改/);broken.alerts.at(-1).actions.find(a=>a.style==='destructive').onPress();await broken.flush();
  assert.equal(broken.stored.length,1);assert.ok(broken.text().includes('已恢复本机副本'));
});

test('长按单笔只打开操作菜单，修改仍沿用原记录身份',async()=>{
  const old={...entry('one','2026-10-14',2800),note:'午餐'},h=appHarness([old]);
  h.get('2026-10-14 午餐 · 餐饮 28.00元，点击编辑').onLongPress();h.render();
  h.get('修改');h.get('删除');assert.equal(h.writes,0);
  assert.throws(()=>h.get('EntryEditor'));
  h.press('修改');assert.equal(h.get('EntryEditor').entry.id,'one');
  await h.save({...old,cents:3000,version:2});
  assert.equal(h.stored.length,1);assert.equal(h.stored[0].id,'one');assert.equal(h.stored[0].cents,3000);
});

test('长按删除需要确认，仅删除选中的一笔，保留其他同类账单',async()=>{
  const h=appHarness([entry('one','2026-10-14',2800),entry('two','2026-10-14',1800)]);
  const longPress=()=>{h.get('2026-10-14 餐饮 28.00元，点击编辑').onLongPress();h.render();};
  longPress();h.press('取消');assert.equal(h.writes,0);
  longPress();h.press('删除');assert.equal(h.writes,0);assert.match(h.alerts.at(-1).body,/28.00/);
  // Dismissing the native confirmation has no write effect.
  h.get('关闭账单操作').onPress();h.render();assert.equal(h.stored.length,2);
  longPress();h.press('删除');h.alerts.at(-1).actions.find(a=>a.style==='destructive').onPress();await h.flush();
  assert.deepEqual(h.stored.map(e=>e.id),['two']);assert.equal(h.writes,1);assert.ok(h.text().includes('18.00'));
});

test('长按删除检测并发更改与存储失败，不删除更新后的账单',async()=>{
  const old=entry('one','2026-10-14',2800);
  for(const failSave of [false,true]){
    const h=appHarness([old],{failSave});
    h.get('2026-10-14 餐饮 28.00元，点击编辑').onLongPress();h.render();
    if(!failSave)h.setStored([{...old,cents:9900}]);
    h.press('删除');h.alerts.at(-1).actions.find(a=>a.style==='destructive').onPress();await h.flush();
    assert.equal(h.stored.length,1);assert.equal(h.stored[0].cents,failSave?2800:9900);
    assert.equal(h.alerts.at(-1).title,'未保存');h.get('修改');
  }
});

test('分类明细遵循月、年、周范围并排除其他分类和收入',()=>{
  const records=[entry('today','2026-10-14',1000),entry('month','2026-10-01',2000),entry('previous','2026-09-30',3000),entry('old','2025-10-14',4000),{...entry('other','2026-10-14',5000),category:'购物'},{...entry('income','2026-10-14',6000),kind:'income',category:'工资'}];
  const h=appHarness(records);h.press('统计');h.press('查看餐饮账单明细');
  h.get('2026-10-01 餐饮 20.00元，点击编辑');h.get('2026-10-14 餐饮 10.00元，点击编辑');
  assert.throws(()=>h.get('2026-09-30 餐饮 30.00元，点击编辑'));assert.throws(()=>h.get('2026-10-14 购物 50.00元，点击编辑'));assert.throws(()=>h.get('2026-10-14 工资 60.00元，点击编辑'));
  h.press('关闭分类明细');h.press('年度分类');h.press('查看餐饮账单明细');
  h.get('2026-09-30 餐饮 30.00元，点击编辑');assert.throws(()=>h.get('2025-10-14 餐饮 40.00元，点击编辑'));
  h.press('关闭分类明细');h.press('周分类');h.press('上一周');h.press('上一周');h.press('查看餐饮账单明细');
  h.get('2026-09-30 餐饮 30.00元，点击编辑');h.get('2026-10-01 餐饮 20.00元，点击编辑');assert.throws(()=>h.get('2026-10-14 餐饮 10.00元，点击编辑'));
  assert.equal(h.writes,0);
});

test('统计明细可长按删除单笔并重新汇总，编辑也能带入原账单',async()=>{
  const h=appHarness([entry('one','2026-10-14',2800),entry('two','2026-10-14',1800)]);
  h.press('统计');h.press('查看餐饮账单明细');
  h.get('2026-10-14 餐饮 28.00元，点击编辑').onLongPress();h.render();h.press('修改');
  assert.equal(h.get('EntryEditor').entry.id,'one');h.get('EntryEditor').onClose();h.render();
  h.press('查看餐饮账单明细');h.get('2026-10-14 餐饮 28.00元，点击编辑').onLongPress();h.render();h.press('删除');
  h.alerts.at(-1).actions.find(a=>a.style==='destructive').onPress();await h.flush();
  assert.equal(h.stored.length,1);h.press('统计');h.press('查看餐饮账单明细');
  h.get('2026-10-14 餐饮 18.00元，点击编辑');assert.throws(()=>h.get('2026-10-14 餐饮 28.00元，点击编辑'));
});

test('晚到的同交易来源根据持久账本清理，未确认的同额消费仍保留',async()=>{
  const h=appHarness([entry(candidate.id,candidate.date,candidate.cents)],{notifications:detectedState()});
  h.press('统计');h.press('更多选项');h.press('消费识别');await h.flush();
  assert.equal(h.get('NotificationInbox').state.drafts.length,0);assert.deepEqual(h.dismissed,[candidate.id]);assert.equal(h.writes,0);
  const duplicate=appHarness([entry('manual',candidate.date,candidate.cents)],{notifications:detectedState()});
  duplicate.press('查看待确认消费');assert.equal(duplicate.get('NotificationInbox').state.drafts[0].possibleDuplicate,true);assert.equal(duplicate.dismissed.length,0);
});
test('账本读取异常时保留支付候选，不确认也不改写坏账本',async()=>{
  const h=appHarness([],{notifications:detectedState()});h.data.set(LEDGER_KEY,'broken');
  h.press('统计');h.press('更多选项');h.press('消费识别');await h.flush();
  assert.equal(h.dismissed.length,0);assert.equal(h.get('NotificationInbox').state.drafts.length,1);assert.equal(h.writes,0);
});

test('识别读取失败仍可查看统计、手动新增编辑和删除，旧账不丢失',async()=>{
  const old=entry('existing','2026-10-14',1000),h=appHarness([old],{notifications:detectedState(),failRead:true});
  h.press('统计');h.press('更多选项');h.press('消费识别');await h.flush();assert.match(h.get('NotificationInbox').error,/读取异常/);
  h.get('NotificationInbox').onClose();h.render();h.press('＋ 记一笔');await h.save(entry('manual','2026-10-14',500));
  assert.equal(h.stored.length,2);assert.equal(h.dismissed.length,0);
  h.press('2026-10-14 餐饮 5.00元，点击编辑');await h.save(entry('manual','2026-10-14',700));assert.equal(h.stored.find(e=>e.id==='manual').cents,700);
  h.get('2026-10-14 餐饮 7.00元，点击编辑').onLongPress();h.render();h.press('删除');h.alerts.at(-1).actions.find(a=>a.style==='destructive').onPress();await h.flush();
  assert.deepEqual(h.stored.map(e=>e.id),['existing']);assert.equal(h.stored[0].cents,1000);
});
