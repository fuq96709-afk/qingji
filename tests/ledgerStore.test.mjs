import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createLedgerStore, LEDGER_KEY, RECOVERY_KEY, LedgerReadError, MAX_LEDGER_BYTES } from '../src/ledgerStore.ts';
import { exportBackup, readImport, mergeImport } from '../src/transfer.ts';
const entry=id=>({id,kind:'expense',cents:3200,category:'餐饮',note:'午饭',date:'2026-10-15',version:1});
function memory(initial=[]){
  const data=new Map(initial),writes=[];let failKey=null;
  return {data,writes,get failKey(){return failKey;},set failKey(value){failKey=value;},
    async getItem(key){return data.get(key)??null;},async setItem(key,value){if(key===failKey)throw new Error('模拟磁盘写入失败');writes.push(key);data.set(key,value);}};
}
test('沿用原存储键，新开实例重读完整账本；保存前留下有效副本',async()=>{
  const old=[entry('old')],storage=memory([[LEDGER_KEY,JSON.stringify(old)]]);
  const store=createLedgerStore(storage);await store.update(current=>({entries:[...current,entry('new')]}));
  assert.deepEqual(await createLedgerStore(storage).read(),[...old,entry('new')]);
  assert.deepEqual(JSON.parse(storage.data.get(RECOVERY_KEY)),old);
  assert.deepEqual(storage.writes,[RECOVERY_KEY,LEDGER_KEY]);
});
test('磁盘写入失败时保留旧账，队列仍可重试；副本失败时不动主账本',async()=>{
  const old=JSON.stringify([entry('old')]),storage=memory([[LEDGER_KEY,old]]),store=createLedgerStore(storage);
  storage.failKey=RECOVERY_KEY;await assert.rejects(()=>store.update(current=>({entries:[...current,entry('new')]})));assert.equal(storage.data.get(LEDGER_KEY),old);
  storage.failKey=LEDGER_KEY;await assert.rejects(()=>store.update(current=>({entries:[...current,entry('new')]})));assert.equal(storage.data.get(LEDGER_KEY),old);assert.equal(storage.data.get(RECOVERY_KEY),old);
  storage.failKey=null;await store.update(current=>({entries:[...current,entry('new')]}));assert.equal((await store.read()).length,2);
});
test('损坏或丢失主账本时阻止空账覆盖，恢复副本需单独调用且不销毁副本',async()=>{
  for(const raw of ['broken',null]){
    const old=JSON.stringify([entry('old')]),storage=memory([[RECOVERY_KEY,old]]);if(raw!==null)storage.data.set(LEDGER_KEY,raw);
    const store=createLedgerStore(storage);await assert.rejects(()=>store.read(),e=>e instanceof LedgerReadError&&e.hasRecovery);
    await assert.rejects(()=>store.update(()=>({entries:[]})),LedgerReadError);assert.equal(storage.writes.length,0);
    assert.deepEqual(await store.restore(),[entry('old')]);assert.equal(storage.data.get(RECOVERY_KEY),old);assert.deepEqual(await store.read(),[entry('old')]);
  }
});
test('损坏副本不恢复，正常主账本不会被旧副本回滚',async()=>{
  const storage=memory([[LEDGER_KEY,'broken'],[RECOVERY_KEY,'broken']]),store=createLedgerStore(storage);
  await assert.rejects(()=>store.read(),e=>e instanceof LedgerReadError&&!e.hasRecovery);await assert.rejects(()=>store.restore());assert.equal(storage.writes.length,0);
  storage.data.set(LEDGER_KEY,JSON.stringify([entry('new')]));storage.data.set(RECOVERY_KEY,JSON.stringify([entry('old')]));
  assert.deepEqual(await store.restore(),[entry('new')]);assert.equal(storage.writes.length,0);
});
test('连续保存和两个实例共享锁时使用最新账本，不覆盖其他新增记录',async()=>{
  const storage=memory();let pending=Promise.resolve();
  const lock=action=>{const result=pending.then(action);pending=result.catch(()=>{});return result;};
  const a=createLedgerStore(storage,lock),b=createLedgerStore(storage,lock);
  await Promise.all([a.update(current=>({entries:[...current,entry('a')]})),a.update(current=>({entries:[...current,entry('b')]})),b.update(current=>({entries:[...current,entry('c')]}))]);
  assert.deepEqual((await b.read()).map(e=>e.id).sort(),['a','b','c']);
});
test('第一次保存失败可以直接重试，不留下一个误导性的空恢复副本',async()=>{
  const storage=memory(),store=createLedgerStore(storage);storage.failKey=LEDGER_KEY;
  await assert.rejects(()=>store.update(()=>({entries:[entry('first')]})));assert.equal(storage.data.has(RECOVERY_KEY),false);
  storage.failKey=null;await store.update(()=>({entries:[entry('first')]}));assert.equal((await store.read()).length,1);
});
test('超容量中文账本与无效内容在写入前拒绝，主账本和副本均不变化',async()=>{
  const storage=memory([[LEDGER_KEY,JSON.stringify([entry('old')])]]),store=createLedgerStore(storage);
  const tooLarge=Array.from({length:2400},(_,i)=>({...entry(String(i)),note:'中'.repeat(200)}));assert.ok(Buffer.byteLength(JSON.stringify(tooLarge))>MAX_LEDGER_BYTES);
  await assert.rejects(()=>store.update(()=>({entries:tooLarge})),/安全存储容量/);
  await assert.rejects(()=>store.update(()=>({entries:[{...entry('bad'),cents:0}]})));
  assert.equal(storage.writes.length,0);assert.deepEqual(await store.read(),[entry('old')]);
});
test('网页导出后空设备导入，所有字段完整，重复导入不会增加记录',async()=>{
  const records=[entry('a'),{...entry('b'),category:'学习',cents:19800,note:'课程',consumption:'rational'}];
  const imported=readImport(exportBackup(records),'backup.json').entries;
  const device=createLedgerStore(memory());await device.update(current=>mergeImport(current,imported));
  assert.deepEqual(await device.read(),records);
  const repeated=await device.update(current=>mergeImport(current,imported));assert.equal(repeated.added,0);assert.equal((await device.read()).length,2);
});
