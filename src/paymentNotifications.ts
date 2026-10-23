import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { mergeCapturedDrafts, parsePaymentNotice } from './paymentNotices';
import type { DetectedExpense, PaymentNotice } from './paymentNotices';

declare class PaymentNotificationsModule extends NativeModule<{onChanged:()=>void}> {
  getStateAsync():Promise<string>;
  setEnabledAsync(enabled:boolean):Promise<void>;
  openSettingsAsync():Promise<void>;
  setScreenEnabledAsync?(enabled:boolean):Promise<void>;
  openScreenSettingsAsync?():Promise<void>;
  acknowledgeAsync(ids:string[]):Promise<void>;
}
let native:PaymentNotificationsModule|null=null;
let moduleFailed=false;
if(Platform.OS==='android'){
  try{native=requireOptionalNativeModule<PaymentNotificationsModule>('QingjiNotifications');}
  catch{moduleFailed=true;}
}
export type NotificationState={available:boolean; enabled:boolean; granted:boolean; screenEnabled:boolean; screenGranted:boolean; dropped:number; drafts:DetectedExpense[]};
export const emptyNotificationState:NotificationState={available:!!native,enabled:false,granted:false,screenEnabled:false,screenGranted:false,dropped:0,drafts:[]};
export const paymentNotifications={
  async read():Promise<NotificationState>{
    if(moduleFailed)throw new Error('消费识别暂不可用，手动记账不受影响。请稍后重试或更新安装包。');
    if(!native)return emptyNotificationState;
    const value=JSON.parse(await native.getStateAsync());
    if(!value||typeof value!=='object'||typeof value.enabled!=='boolean'||typeof value.granted!=='boolean'||!Array.isArray(value.pending)||value.pending.length>200)throw new Error('消费通知读取失败，请稍后重试');
    const drafts:DetectedExpense[]=[],ignored:string[]=[];
    for(const notice of value.pending){const draft=parsePaymentNotice(notice);if(draft)drafts.push(draft);else if(typeof (notice as PaymentNotice)?.id==='string')ignored.push(notice.id);}
    if(ignored.length)await native.acknowledgeAsync(ignored);
    return {available:true,enabled:value.enabled,granted:value.granted,screenEnabled:value.screenEnabled===true,screenGranted:value.screenGranted===true,dropped:Number.isSafeInteger(value.dropped)?Math.max(0,value.dropped):0,drafts:mergeCapturedDrafts(drafts)};
  },
  async enable(){if(!native)throw new Error('请在安卓安装版中开启通知识别');await native.setEnabledAsync(true);await native.openSettingsAsync();},
  async disable(){if(native)await native.setEnabledAsync(false);},
  async enableScreens(){
    if(!native)throw new Error('请在安卓安装版中开启页面识别');
    if(!native.setScreenEnabledAsync||!native.openScreenSettingsAsync)throw new Error('请先更新安卓安装包，再开启页面识别');
    await native.setScreenEnabledAsync(true);await native.openScreenSettingsAsync();
  },
  async disableScreens(){if(native?.setScreenEnabledAsync)await native.setScreenEnabledAsync(false);},
  async dismiss(id:string){if(native)await native.acknowledgeAsync([id]);},
  async dismissMany(ids:string[]){if(native&&ids.length)await native.acknowledgeAsync(ids);},
  subscribe(listener:()=>void,onError?:(error:unknown)=>void){
    try{
      const subscription=native?.addListener('onChanged',listener);
      return ()=>{try{subscription?.remove();}catch{/* A failed optional subscription must not interrupt closing the app. */}};
    }catch(error){onError?.(error);return ()=>{};}
  }
};
