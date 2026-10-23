import { parseSavedEntries } from './ledger.ts';
import type { Entry } from './ledger.ts';

export const LEDGER_KEY='qingji-v1:guest';
export const RECOVERY_KEY=LEDGER_KEY+':previous';
// shortcut: keep values below Android's ~2 MB read limit; use a database before supporting larger ledgers.
export const MAX_LEDGER_BYTES=1536*1024;
type Storage={getItem:(key:string)=>Promise<string|null>;setItem:(key:string,value:string)=>Promise<void>};
type Exclusive=<T>(action:()=>Promise<T>)=>Promise<T>;
export class LedgerReadError extends Error {
  hasRecovery:boolean;
  constructor(hasRecovery:boolean){super('本机账本读取失败，请勿清除应用数据。');this.hasRecovery=hasRecovery;}
}
function encode(entries:Entry[]){
  const raw=JSON.stringify(entries);parseSavedEntries(raw);
  let bytes=0;
  for(const char of raw){const code=char.codePointAt(0)!;bytes+=code<=0x7f?1:code<=0x7ff?2:code<=0xffff?3:4;if(bytes>MAX_LEDGER_BYTES)throw new Error('账本超过当前安全存储容量，本次未保存。原账单仍保留，请先导出备份。');}
  return raw;
}
export function createLedgerStore(storage:Storage,deviceLock:Exclusive=action=>action()){
  let pending:Promise<unknown>=Promise.resolve();
  function exclusive<T>(action:()=>Promise<T>):Promise<T>{
    const result=pending.then(()=>deviceLock(action));pending=result.catch(()=>{});return result;
  }
  async function primary(){
    try{
      const raw=await storage.getItem(LEDGER_KEY);
      if(raw===null&&await storage.getItem(RECOVERY_KEY)!==null)throw new Error('主账本缺失');
      return {raw,entries:parseSavedEntries(raw)};
    }catch{
      let hasRecovery=false;
      try{const backup=await storage.getItem(RECOVERY_KEY);if(backup!==null){parseSavedEntries(backup);hasRecovery=true;}}catch{}
      throw new LedgerReadError(hasRecovery);
    }
  }
  return {
    async read(){return (await primary()).entries;},
    update<T extends {entries:Entry[]}>(change:(current:Entry[])=>T):Promise<T>{return exclusive(async()=>{
      const current=await primary();
      const result=change(current.entries),next=encode(result.entries);
      if(next!==current.raw){
        // Keep a valid previous snapshot before touching the primary ledger.
        try{
          if(current.raw!==null)await storage.setItem(RECOVERY_KEY,current.raw);
          await storage.setItem(LEDGER_KEY,next);
        }catch{throw new Error('本机保存未完成，请检查手机存储空间后重试。请勿卸载或清除应用数据。');}
      }
      return result;
    });},
    restore(){return exclusive(async()=>{
      const current=await storage.getItem(LEDGER_KEY);
      if(current!==null){try{return parseSavedEntries(current);}catch{}}
      const backup=await storage.getItem(RECOVERY_KEY);
      if(backup===null)throw new Error('没有可恢复的本机副本');
      const entries=parseSavedEntries(backup);encode(entries);
      await storage.setItem(LEDGER_KEY,backup);
      return entries;
    });}
  };
}
