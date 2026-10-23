import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as ledger from '../src/ledger.ts';

const require=createRequire(import.meta.url);
// Run the real component handlers, including delayed native scroll events.
function harness(component,props){
  const slots=[];let cursor=0,effects=[],tree;
  const react={...require('react'),
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
    useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useMemo(fn,deps){const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i].deps[j]))slots[i]={deps,value:fn()};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((d,j)=>d!==slots[i][j])){slots[i]=deps;effects.push(fn);}}
  };
  const mocks={react,'react-native':{StyleSheet:{create:v=>v},...Object.fromEntries(['FlatList','Pressable','Text','View'].map(n=>[n,n]))},'./Motion':{BottomSheet:'BottomSheet'},'./ledger':ledger};
  const source=ts.transpileModule(readFileSync(new URL('../src/DateWheel.tsx',import.meta.url),'utf8')+'\nexport { Wheel };',{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(source,{exports:module.exports,module,require:name=>mocks[name]||require(name)});
  function nodes(node,out=[]){
    if(!node||typeof node!=='object')return out;
    if(Array.isArray(node)){node.forEach(n=>nodes(n,out));return out;}
    out.push(node);nodes(node.type==='BottomSheet'?node.props.children(action=>action()):node.props.children,out);return out;
  }
  function render(next={}){props={...props,...next};cursor=0;tree=module.exports[component](props);effects.splice(0).forEach(fn=>fn());}
  function get(predicate){const node=nodes(tree).find(predicate);assert.ok(node);return node.props;}
  render();return {render,get,list:()=>get(n=>n.type==='FlatList'),wheel:suffix=>get(n=>n.props.suffix===suffix),press:text=>get(n=>n.type==='Pressable'&&n.props.children?.props?.children===text).onPress()};
}
const event=index=>({nativeEvent:{contentOffset:{y:index*44}}});
const days=Array.from({length:31},(_,i)=>i+1);

test('打开16日时初始化的零偏移事件不会覆盖为1日',()=>{
  const changes=[];const h=harness('Wheel',{values:days,value:16,suffix:'日',onChange:n=>changes.push(n)});
  h.list().onContentSizeChange();h.list().onScroll(event(0));h.list().onScroll(event(15));
  assert.deepEqual(changes,[]);
});
test('点选16日后延迟的定位和惯性事件不会改回1日',()=>{
  const changes=[];const h=harness('Wheel',{values:days,value:1,suffix:'日',onChange:n=>changes.push(n)});
  h.list().onContentSizeChange();h.list().onScrollBeginDrag();
  h.list().renderItem({item:16,index:15}).props.onPress();h.render({value:16});
  h.list().onScroll(event(0));h.list().onMomentumScrollEnd(event(0));
  assert.deepEqual(changes,[16]);assert.equal(h.list().extraData,16);
});
test('手动滑动和惯性结束选择最终日期，结束后忽略自动定位事件',()=>{
  const changes=[];const h=harness('Wheel',{values:days,value:1,suffix:'日',onChange:n=>changes.push(n)});
  h.list().onScrollBeginDrag();h.list().onScroll(event(14));h.render({value:15});
  h.list().onScrollEndDrag(event(15));h.render({value:16});
  h.list().onMomentumScrollEnd(event(16));h.render({value:17});h.list().onScroll(event(0));
  assert.deepEqual(changes,[15,16,17]);
});
test('外部日期更新不会被此前滚动事件覆盖',()=>{
  const changes=[];const h=harness('Wheel',{values:days,value:1,suffix:'日',onChange:n=>changes.push(n)});
  h.list().onScrollBeginDrag();h.render({value:16});h.list().onScroll(event(0));
  assert.deepEqual(changes,[]);
});
test('日期确认保留16日；二月和闰年只修正超出月份的天数',()=>{
  const confirmed=[];const h=harness('default',{value:'2026-10-01',onConfirm:d=>confirmed.push(d),onCancel(){}});
  h.wheel('日').onChange(16);h.render();h.press('完成');assert.equal(confirmed.at(-1),'2026-10-16');
  h.wheel('月').onChange(2);h.render();h.press('完成');assert.equal(confirmed.at(-1),'2026-02-16');
  h.wheel('月').onChange(1);h.render();h.wheel('日').onChange(31);h.render();h.wheel('月').onChange(2);h.render();h.press('完成');assert.equal(confirmed.at(-1),'2026-02-28');
  h.wheel('年').onChange(2028);h.render();h.wheel('日').onChange(29);h.render();h.press('完成');assert.equal(confirmed.at(-1),'2028-02-29');
  h.wheel('年').onChange(2027);h.render();h.press('完成');assert.equal(confirmed.at(-1),'2027-02-28');
});
test('取消不提交日期；年月模式只选择年月；没有底部提示和今天按钮',()=>{
  const confirmed=[];let cancelled=0;
  const h=harness('default',{value:'2026-10-16',onConfirm:d=>confirmed.push(d),onCancel(){cancelled++;}});
  h.wheel('日').onChange(1);h.render();h.press('取消');assert.equal(cancelled,1);assert.equal(confirmed.length,0);
  assert.throws(()=>h.press('今天'));
  const month=harness('default',{mode:'month',value:'2026-10-01',onConfirm:d=>confirmed.push(d),onCancel(){}});
  month.wheel('月').onChange(9);month.render();month.press('完成');assert.equal(confirmed.at(-1),'2026-09-01');
});
