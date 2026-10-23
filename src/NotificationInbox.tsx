import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { money } from './ledger';
import { paymentNotifications } from './paymentNotifications';
import type { NotificationState } from './paymentNotifications';
import type { DetectedExpense } from './paymentNotices';

export default function NotificationInbox({state,error,onRefresh,onClose,onChoose}:{state:NotificationState;error:string;onRefresh:()=>Promise<void>;onClose:()=>void;onChoose:(draft:DetectedExpense)=>void}) {
  const [working,setWorking]=useState(false),[failure,setFailure]=useState('');
  async function act(action:()=>Promise<void>){
    if(working)return;setWorking(true);setFailure('');
    try{await action();await onRefresh();}catch(e){setFailure(e instanceof Error?e.message:'操作失败，请重试');}finally{setWorking(false);}
  }
  function action(label:string,onPress:()=>void,primary=false){return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={working} onPress={onPress} style={({pressed})=>[s.button,primary&&s.primary,(pressed||working)&&{opacity:.6}]}><Text style={primary?s.white:s.accent}>{label}</Text></Pressable>;}
  return <SafeAreaView style={s.screen}>
    <View style={s.header}><Text style={s.title}>消费识别</Text>{action('关闭',onClose)}</View>
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.body}>{state.available?'微信、支付宝的消费先放在这里，核对后才计入账本。':'需要安卓安装版。网页预览不能读取手机通知或支付页面。'}</Text>
      {state.available&&<>
        <Text style={s.heading}>通知识别 · {state.enabled&&state.granted?'已开启':state.enabled?'等待授权':'未开启'}</Text>
        <Text style={s.body}>需要你在系统设置中允许读取通知。只保留符合消费规则的微信、支付宝通知，在本机处理，不上传；普通聊天通知不保存。</Text>
        {state.enabled&&!state.granted&&<Text style={s.body}>在系统页面找到“轻记”，允许读取通知后返回这里。</Text>}
        {(!state.enabled||!state.granted)&&action(state.enabled?'去授权':'开启通知识别',()=>void act(()=>paymentNotifications.enable()),true)}
        {state.enabled&&action('暂停通知识别',()=>void act(()=>paymentNotifications.disable()))}
        <View style={s.divider}/>
        <Text style={s.heading}>支付页面识别 · {state.screenEnabled&&state.screenGranted?'已开启':state.screenEnabled?'等待授权':'未开启'}</Text>
        <Text style={s.body}>试用功能，需要单独开启无障碍服务“轻记 · 支付页面识别”。只在支持的微信、支付宝支付窗口读取文字，保留符合规则的支付成功页，在本机处理，不上传。不会点击、代付或读取密码；可随时暂停或撤销授权。</Text>
        {state.screenEnabled&&!state.screenGranted&&<Text style={s.body}>在系统无障碍设置中找到“轻记 · 支付页面识别”，开启后返回这里。不同品牌的菜单名称可能不同。</Text>}
        {(!state.screenEnabled||!state.screenGranted)&&action(state.screenEnabled?'去开启页面授权':'开启页面识别',()=>void act(()=>paymentNotifications.enableScreens()),true)}
        {state.screenEnabled&&action('暂停页面识别',()=>void act(()=>paymentNotifications.disableScreens()))}
        <Text style={s.body}>使用安卓通用接口，不限制手机品牌。权限和后台限制因系统而异；页面需要在手机上显示，当前只适配部分支付页面，未识别时可照常手动记账。</Text>
      </>}
      {!!(failure||error)&&<View><Text accessibilityRole="alert" style={s.error}>{failure||error}</Text>{action('重新读取',()=>void act(onRefresh))}</View>}
      {state.dropped>0&&<Text style={s.error}>待确认记录曾达到上限，部分记录未保留，请核对账单。</Text>}
      <View style={s.divider}/>
      <Text style={s.heading}>待确认{state.drafts.length?' · '+state.drafts.length:''}</Text>
      <Text style={s.body}>日期按识别时间填写。相同交易编号会合并；只有金额相同不会合并。如果已经记过，请忽略。</Text>
      {state.drafts.length?state.drafts.map(draft=><View key={draft.id} style={s.draft}>
        <View style={s.line}><Text style={s.title}>{draft.amountOptions?'金额待核对':'¥ '+money(draft.cents)}</Text><Text style={s.body}>{draft.source} · {draft.channel==='screen'?'页面':'通知'} · {draft.date}</Text></View>
        {draft.amountOptions&&<Text style={s.error}>同一交易识别到不同金额（{draft.amountOptions.map(amount=>'¥ '+money(amount)).join(' / ')}），请核对原账单并输入实际金额。</Text>}
        {draft.possibleDuplicate&&<Text style={s.error}>疑似重复：有金额相同的记录，请先核对是否已记账。</Text>}
        <Text style={s.original}>{draft.text}</Text>
        <View style={s.actions}>{action('忽略',()=>void act(()=>paymentNotifications.dismiss(draft.id)))}{action(draft.amountOptions?'核对记账':'确认记账',()=>{if(!working)onChoose(draft);},true)}</View>
      </View>):<Text style={s.empty}>暂时没有待确认的消费</Text>}
    </ScrollView>
  </SafeAreaView>;
}
const s=StyleSheet.create({
  screen:{flex:1,backgroundColor:'#FFFFFF'},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:20,minHeight:64},content:{padding:24,gap:16,paddingBottom:36},
  title:{fontSize:19,fontWeight:'600',color:'#272332'},heading:{fontSize:16,fontWeight:'500',color:'#272332'},body:{fontSize:13,lineHeight:21,color:'#706B77'},
  button:{minHeight:44,paddingHorizontal:16,paddingVertical:12,alignItems:'center',justifyContent:'center',borderRadius:12},primary:{backgroundColor:'#7356AC'},white:{color:'#FFFFFF',fontSize:14,fontWeight:'500'},accent:{color:'#7356AC',fontSize:14,fontWeight:'500'},
  divider:{height:1,backgroundColor:'#F0EEF4',marginVertical:6},draft:{borderTopWidth:1,borderTopColor:'#F0EEF4',paddingTop:18,gap:12},line:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},original:{color:'#504B59',fontSize:13,lineHeight:21},actions:{flexDirection:'row',justifyContent:'flex-end',gap:12},error:{fontSize:13,lineHeight:21,color:'#A44747'},empty:{paddingVertical:32,textAlign:'center',fontSize:14,color:'#706B77'}
});
