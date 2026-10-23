import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as ledger from '../src/ledger.ts';
import { categoryIcons } from '../src/categoryIcons.ts';
import { calculate } from '../src/calculator.ts';

// Exercise the editor's actual event handlers without a device or access to saved bills.
const realRequire=createRequire(import.meta.url);
function editorHarness(entry=null,initial,noteHistory={}){
  const slots=[];let cursor=0,saved=[],closed=0,deleted=0,keyboardHide;
  const backAction={current:null};
  const mocks={
    react:{...realRequire('react'),useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(effect){const i=cursor++;if(!(i in slots))slots[i]=effect();},useImperativeHandle(ref,create){ref.current=create();}},
    'react-native':{Keyboard:{dismiss(){},addListener(_event,callback){keyboardHide=callback;return {remove(){}};}},Platform:{OS:'android'},StyleSheet:{create:v=>v},...Object.fromEntries(['KeyboardAvoidingView','Pressable','ScrollView','Text','TextInput','View'].map(n=>[n,n]))},
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
    './ledger':ledger,'./categoryIcons':{categoryIcons},'./calculator':{calculate},
    '@expo/vector-icons/MaterialCommunityIcons':{__esModule:true,default:'CategoryIcon'},
    './DateWheel':{__esModule:true,default:'DateWheel'},
    './Motion':{BottomSheet:'BottomSheet'}
  };
  const source=ts.transpileModule(readFileSync(new URL('../src/EntryEditor.tsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(source,{exports:module.exports,module,require:name=>mocks[name]||realRequire(name)});
  let tree;
  function render(){cursor=0;tree=module.exports.default({entry,initial,noteHistory,id:entry?.id||'new-id',busy:false,backAction,onSave:e=>saved.push(e),onClose:()=>closed++,onDelete:()=>deleted++});return tree;}
  function nodes(node,out=[]){
    if(!node)return out;
    if(Array.isArray(node)){node.forEach(n=>nodes(n,out));return out;}
    if(typeof node!=='object')return out;
    if(typeof node.type==='function')return nodes(node.type(node.props),out);
    out.push(node);
    const children=node.type==='BottomSheet'?node.props.children(action=>action()):node.props.children;
    nodes(children,out);return out;
  }
  function get(label){const match=nodes(tree).find(n=>n.props.accessibilityLabel===label||n.type===label);assert.ok(match,'missing '+label);return match.props;}
  function press(label){get(label).onPress();render();}
  render();return {render,get,press,has:label=>nodes(tree).some(n=>n.props.accessibilityLabel===label||n.type===label),hideKeyboard(){keyboardHide();render();},back(){backAction.current();render();},saved,get closed(){return closed;},get deleted(){return deleted;}};
}
const old={id:'old-id',version:2,date:'2025-12-31',kind:'expense',category:'VPN',cents:3990,note:'旧备注',consumption:'rational'};
test('新记账先只显示分类，选择用途后展开金额备注与键盘并保存',()=>{
  const h=editorHarness();
  h.get('餐饮');h.get('购物');
  for(const label of ['金额算式 0','备注','日期，今天','情绪消费','理性消费','保存账单','7'])assert.equal(h.has(label),false,label);
  h.press('餐饮');h.get('金额算式 0');h.get('备注');h.get('日期，今天');
  for(const key of ['2','5','.','5'])h.press(key);
  h.press('理性消费');h.press('保存账单');
  const saved=JSON.parse(JSON.stringify(h.saved[0]));
  assert.deepEqual(saved,{id:'new-id',version:1,kind:'expense',category:'餐饮',cents:2550,date:ledger.today(),note:'',consumption:'rational'});
  ledger.parseSavedEntries(JSON.stringify(h.saved));
});
test('加减算式由完成按钮直接计算并保存，收入可直接完成',()=>{
  const h=editorHarness();h.press('餐饮');for(const key of ['1','2','.','5','+','2','−','1'])h.press(key);
  assert.equal(h.saved.length,0);h.get('日期，今天');
  h.press('收入');assert.equal(h.has('保存账单'),false);assert.equal(h.has('备注'),false);h.press('工资');h.press('保存账单');
  assert.equal(h.saved[0].kind,'income');assert.equal(h.saved[0].cents,1350);assert.equal(h.saved[0].consumption,undefined);
});
test('算式未完成时可直接换用途，日期弹窗返回后继续输入同一算式',()=>{
  const h=editorHarness();h.press('餐饮');for(const key of ['1','2','+'])h.press(key);
  h.press('交通');h.press('日期，今天');h.back();assert.equal(h.closed,0);
  h.press('3');h.press('情绪消费');h.press('保存账单');
  assert.equal(h.saved[0].cents,1500);assert.equal(h.saved[0].category,'交通');assert.equal(h.saved[0].consumption,'emotional');
});
test('编辑日期、备注和金额保留记录身份，取消日期保留原值',()=>{
  const h=editorHarness(old);
  h.press('日期，2025/12/31');h.get('DateWheel').onCancel();h.render();
  for(const key of ['1','2','3','.','4','5'])h.press(key);
  h.press('日期，2025/12/31');h.get('DateWheel').onConfirm('2026-02-28');h.render();
  h.get('备注').onFocus();h.get('备注').onChangeText(' 新备注 ');h.render();h.press('完成备注');h.press('保存账单');
  assert.deepEqual(JSON.parse(JSON.stringify(h.saved[0])),{...old,cents:12345,date:'2026-02-28',note:'新备注'});
  h.back();assert.equal(h.closed,1);
});
test('选择16日后日期键完整显示并按16日保存，重新编辑保留16日',()=>{
  const h=editorHarness();h.press('餐饮');h.press('2');h.press('日期，今天');
  h.get('DateWheel').onConfirm('2026-10-16');h.render();
  const key=h.get('日期，2026/10/16');
  const lines=key.children[1].props.children;
  assert.equal(lines[0].props.children,'2026');assert.equal(lines[1].props.children,'10/16');
  assert.equal(lines[1].props.numberOfLines,1);assert.equal(lines[1].props.adjustsFontSizeToFit,true);
  h.press('保存账单');assert.equal(h.saved[0].date,'2026-10-16');
  const edit=editorHarness(h.saved[0]);edit.press('日期，2026/10/16');assert.equal(edit.get('DateWheel').value,'2026-10-16');
});
test('未选用途没有保存入口，无效算式与零金额不会保存，旧账删除仍可用',()=>{
  const h=editorHarness();assert.equal(h.has('保存账单'),false);
  h.press('餐饮');h.press('保存账单');assert.equal(h.saved.length,0);
  h.press('0');h.press('保存账单');assert.equal(h.saved.length,0);
  h.press('退格');h.press('1');h.press('−');h.press('2');h.press('保存账单');assert.equal(h.saved.length,0);
  h.press('退格');h.press('保存账单');assert.equal(h.saved.length,0);
  const edit=editorHarness(old);edit.press('删除这笔账');assert.equal(edit.deleted,1);
});

test('通知带入金额日期备注但不擅自选择用途，确认后才保存',()=>{
  const h=editorHarness(null,{cents:3200,date:'2026-10-13',note:'午饭'});
  assert.equal(h.has('保存账单'),false);assert.equal(h.has('备注'),false);
  h.press('餐饮');
  h.get('金额算式 32.00');h.get('日期，2026/10/13');assert.equal(h.get('备注').value,'午饭');
  assert.equal(h.saved.length,0);h.press('保存账单');
  assert.equal(h.saved[0].cents,3200);assert.equal(h.saved[0].date,'2026-10-13');assert.equal(h.saved[0].note,'午饭');assert.equal(h.saved[0].consumption,undefined);
});

test('备注直接在原栏输入，系统键盘替换数字键盘，返回保留草稿',()=>{
  const h=editorHarness();h.press('餐饮');h.press('3');h.press('2');
  assert.equal(h.get('备注').multiline,undefined);assert.equal(h.has('BottomSheet'),false);
  h.get('备注').onFocus();h.get('备注').onChangeText('中午饭');h.render();
  assert.equal(h.has('保存账单'),false);h.back();assert.equal(h.closed,0);
  assert.equal(h.get('备注').value,'中午饭');h.get('保存账单');
  h.get('备注').onFocus();h.render();h.hideKeyboard();h.get('保存账单');assert.equal(h.get('备注').value,'中午饭');
  h.press('保存账单');assert.equal(h.saved[0].note,'中午饭');assert.equal(h.saved[0].cents,3200);
});
test('历史备注点选直接填入，不输入文字也能保存，取消前不改变任何已存备注',()=>{
  const h=editorHarness(null,undefined,{'expense:餐饮':['中午饭'],'expense:交通':['地铁']});
  h.press('交通');h.press('4');h.get('备注').onFocus();h.render();
  h.press('使用备注：地铁');assert.equal(h.get('备注').value,'地铁');h.get('保存账单');
  assert.equal(h.saved.length,0);h.press('保存账单');assert.equal(h.saved[0].note,'地铁');assert.equal(h.saved[0].cents,400);
});

test('历史备注随当前用途切换，未选择或该用途没有历史时不显示其他分类内容',()=>{
  const h=editorHarness(null,undefined,{'expense:餐饮':['中午饭'],'expense:学习':['买书'],'expense:其他':['杂物'],'income:其他':['报销']});
  assert.equal(h.has('使用备注：中午饭'),false);assert.equal(h.has('使用备注：买书'),false);
  h.press('餐饮');h.get('使用备注：中午饭');assert.equal(h.has('使用备注：买书'),false);
  h.press('学习');h.get('使用备注：买书');assert.equal(h.has('使用备注：中午饭'),false);
  h.press('交通');assert.equal(h.has('使用备注：中午饭'),false);assert.equal(h.has('使用备注：买书'),false);
  h.press('其他');h.get('使用备注：杂物');assert.equal(h.has('使用备注：报销'),false);
  h.press('收入');assert.equal(h.has('使用备注：杂物'),false);h.press('其他');h.get('使用备注：报销');assert.equal(h.has('使用备注：杂物'),false);
});

test('从金额返回分类保留草稿，再选用途恢复；编辑旧账直接显示完整内容',()=>{
  const h=editorHarness();h.press('餐饮');h.press('3');h.press('2');h.press('理性消费');
  h.get('备注').onChangeText('午饭');h.render();
  h.press('日期，今天');h.get('DateWheel').onConfirm('2026-10-12');h.render();
  h.back();assert.equal(h.has('备注'),false);assert.equal(h.has('保存账单'),false);assert.equal(h.closed,0);
  h.press('交通');h.get('金额算式 32');h.get('日期，2026/10/12');assert.equal(h.get('备注').value,'午饭');
  h.press('保存账单');assert.equal(h.saved[0].cents,3200);assert.equal(h.saved[0].category,'交通');assert.equal(h.saved[0].consumption,'rational');
  const choose=editorHarness();choose.back();assert.equal(choose.closed,1);
  const edit=editorHarness(old);edit.get('金额算式 39.90');edit.get('备注');edit.get('保存账单');edit.back();assert.equal(edit.closed,1);
});
