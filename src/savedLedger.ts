import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createLedgerStore, LEDGER_KEY } from './ledgerStore';

function deviceLock<T>(action:()=>Promise<T>):Promise<T>{
  if(Platform.OS==='web'&&typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request(LEDGER_KEY,action);
  return action();
}
export const savedLedger=createLedgerStore(AsyncStorage,deviceLock);
