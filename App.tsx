import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import DateWheel from './src/DateWheel';
import { consumptionLabels, Consumption, filterByConsumption, groupEntriesByDate, Entry, money, spendingOverview, weekBounds, today, daysInMonth, shiftStatsPeriod } from './src/ledger';
import EntryEditor from './src/EntryEditor';
import { categoryIcons } from './src/categoryIcons';
import { FadeView, useReducedMotion } from './src/Motion';
import DataManager from './src/DataManager';
import { mergeImport } from './src/transfer';
import NotificationInbox from './src/NotificationInbox';
import { emptyNotificationState, paymentNotifications } from './src/paymentNotifications';
import type { DetectedExpense } from './src/paymentNotices';
import { flagPossibleDuplicates } from './src/paymentNotices';
import { savedLedger } from './src/savedLedger';
import { LedgerReadError } from './src/ledgerStore';
const displayMoney = (cents:number) => money(cents).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const monthLabel = (month:string) => month.slice(0,4)+'年'+Number(month.slice(5))+'月';
function dayLabel(date:string){
  const now=today();const yesterday=new Date(now+'T12:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);
  const relative=date===now?'今天':date===yesterday.toISOString().slice(0,10)?'昨天':'';
  return {relative,date:(date.slice(0,4)===now.slice(0,4)?'':date.slice(0,4)+'年')+Number(date.slice(5,7))+'月'+Number(date.slice(8))+'日'};
}
const message = (e: unknown) => e instanceof Error ? e.message : '操作失败，请重试';
function notify(title:string, body:string, actions?:{text:string;style?:'cancel'|'destructive';onPress?:()=>void}[]) {
  if(Platform.OS!=='web') { Alert.alert(title,body,actions); return; }
  if(actions) { if(window.confirm(title+'\n'+body)) actions.find(a=>a.style==='destructive')?.onPress?.(); }
  else window.alert(title+'\n'+body);
}
function Button({title,onPress,disabled=false,light=false,selected,label}: {title:string;onPress:()=>void;disabled?:boolean;light?:boolean;selected?:boolean;label?:string}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label||title} accessibilityState={{disabled,selected}} disabled={disabled} onPress={onPress} style={({pressed})=>[s.button,light&&s.light,disabled&&{opacity:.4},pressed&&{opacity:.85,transform:[{scale:.97}]}]}><Text style={[s.buttonText,light&&s.buttonTextLight]}>{title}</Text></Pressable>;
}
export default function App() {
  const [entries,setEntries]=useState<Entry[]>([]), [loading,setLoading]=useState(true), [busy,setBusy]=useState(false), [notice,setNotice]=useState('');
  const [feedback,setFeedback]=useState<{text:string}|null>(null);
  const [recoveryAvailable,setRecoveryAvailable]=useState(false);
  const [notificationState,setNotificationState]=useState(emptyNotificationState),[notificationError,setNotificationError]=useState(''),[inbox,setInbox]=useState(false);
  const [initial,setInitial]=useState<DetectedExpense|undefined>(undefined);
  const notificationRequest=useRef(0);
  async function refreshNotifications(){
    const token=++notificationRequest.current;
    try{
      const state=await paymentNotifications.read();
      if(state.drafts.length){
        // Only clear captures after verifying that their exact identity was persisted.
        const saved=await savedLedger.read();
        const committed=state.drafts.filter(draft=>saved.some(entry=>entry.id===draft.id)).map(draft=>draft.id);
        if(committed.length){await paymentNotifications.dismissMany(committed);state.drafts=state.drafts.filter(draft=>!committed.includes(draft.id));}
      }
      if(token===notificationRequest.current){setNotificationState(state);setNotificationError('');}
    }
    catch(e){if(token===notificationRequest.current)setNotificationError(message(e));}
  }
  useEffect(()=>{
    void refreshNotifications();
    const unsubscribe=paymentNotifications.subscribe(()=>void refreshNotifications(),()=>setNotificationError('消费识别暂不可用，手动记账不受影响。可稍后重新读取。'));
    const listener=AppState.addEventListener('change',state=>{if(state==='active')void refreshNotifications();});
    return ()=>{unsubscribe();listener.remove();notificationRequest.current++;};
  },[]);
  useEffect(()=>{if(!feedback)return;const timer=setTimeout(()=>setFeedback(null),2200);return ()=>clearTimeout(timer);},[feedback]);
  const [ledgerMonth,setLedgerMonth]=useState(today().slice(0,7)), [tab,setTab]=useState('ledger');
  const [statsMonth,setStatsMonth]=useState(today().slice(0,7));
  const month=tab==='overview'?statsMonth:ledgerMonth;
  const [dataManager,setDataManager]=useState(false);
  const [moreOpen,setMoreOpen]=useState(false);
  const [monthPicker,setMonthPicker]=useState(false);
  const [period,setPeriod]=useState<'year'|'month'|'week'>('month');
  const reducedMotion=useReducedMotion();
  const [weekStart,setWeekStart]=useState(weekBounds(today()).start);
  const [editor,setEditor]=useState(false), [editing,setEditing]=useState<Entry|null>(null);
  const [actionEntry,setActionEntry]=useState<Entry|null>(null);
  const [categoryDetail,setCategoryDetail]=useState<{category:string;start:string;end:string}|null>(null);
  useEffect(()=>setMoreOpen(false),[tab,editor,month]);
  const [consumptionFilter,setConsumptionFilter]=useState<'all'|Consumption>('all');
  const lock=useRef(false), request=useRef(0), readFailed=useRef(false), draftId=useRef(''), editorBack=useRef<(()=>void)|null>(null);
  async function refresh(){
    if(lock.current)return;
    const token=++request.current;
    try{
      const rows=await savedLedger.read();
      if(request.current!==token)return;
      setEntries(rows);setNotice('');setRecoveryAvailable(false);readFailed.current=false;
    }catch(e){if(request.current===token){readFailed.current=true;setRecoveryAvailable(e instanceof LedgerReadError&&e.hasRecovery);setNotice('本机账本读取失败，请勿清除应用数据。');}}
    finally{if(request.current===token)setLoading(false);}
  }
  useEffect(()=>{
    void refresh();
    const listener=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});
    return ()=>{listener.remove();request.current++;};
  },[]);
  function open(entry?:Entry){setActionEntry(null);setCategoryDetail(null);setInitial(undefined);draftId.current=entry?.id||Crypto.randomUUID();setEditing(entry||null);setEditor(true);}
  function openDetected(draft:DetectedExpense){if(disabled||entries.some(e=>e.id===draft.id))return;setInbox(false);setInitial(draft);draftId.current=draft.id;setEditing(null);setEditor(true);}
  async function mutate(entry:Entry,remove=false,expected:Entry|null=editing){
    if(lock.current)return;
    if(readFailed.current){notify('暂时无法保存','请关闭编辑，成功刷新账本后重试。');return;}
    lock.current=true;request.current++;setBusy(true);
    try{
      const result=await savedLedger.update(current=>{
        const existing=current.find(e=>e.id===entry.id);
        if(expected||remove){
          if(!existing||JSON.stringify(existing)!==JSON.stringify(expected))throw new Error('这笔账单已在其他页面更改，请关闭后重新打开，避免覆盖新内容。');
        }else if(existing)throw new Error('这笔账单已经保存，请关闭后查看账本。');
        return {entries:remove?current.filter(e=>e.id!==entry.id):[...current.filter(e=>e.id!==entry.id),entry]};
      });
      const next=result.entries;
      setEntries(next);setTab('ledger');if(!remove)setConsumptionFilter('all');setEditor(false);setActionEntry(null);setCategoryDetail(null);setNotice('');setLedgerMonth(entry.date.slice(0,7));
      setFeedback(remove?{text:'已删除'}:null);
      if(initial?.id===entry.id){try{await paymentNotifications.dismiss(entry.id);await refreshNotifications();}catch{setNotificationError('账单已保存，通知列表稍后再读取。');}}
    }catch(e){if(e instanceof LedgerReadError){readFailed.current=true;setRecoveryAvailable(e.hasRecovery);setNotice(e.message);}notify('未保存',message(e));}
    finally{lock.current=false;setBusy(false);}
  }
  async function readForTransfer(){
    try{return await savedLedger.read();}
    catch(e){readFailed.current=true;setRecoveryAvailable(e instanceof LedgerReadError&&e.hasRecovery);setNotice('本机账本读取失败，请勿清除应用数据。');throw new Error('本机账本读取失败，请成功刷新后重试');}
  }
  async function importEntries(incoming:Entry[]){
    if(lock.current||readFailed.current)throw new Error('账本暂时无法保存，请成功刷新后重试');
    lock.current=true;request.current++;setBusy(true);
    try{
      const result=await savedLedger.update(current=>mergeImport(current,incoming));
      setEntries(result.entries);setNotice('');setTab('ledger');setConsumptionFilter('all');
      return result;
    }catch(e){if(e instanceof LedgerReadError){readFailed.current=true;setRecoveryAvailable(e.hasRecovery);setNotice(e.message);}throw e;}
    finally{lock.current=false;setBusy(false);}
  }
  async function restoreLedger(){
    if(lock.current)return;lock.current=true;request.current++;setBusy(true);
    try{const rows=await savedLedger.restore();setEntries(rows);setNotice('');setRecoveryAvailable(false);readFailed.current=false;setLedgerMonth(rows[rows.length-1]?.date.slice(0,7)||today().slice(0,7));setTab('ledger');setFeedback({text:'已恢复本机副本，请核对最近账单'});}
    catch{setNotice('恢复未完成，请勿清除应用数据。');}
    finally{lock.current=false;setBusy(false);}
  }
  function showStats(){const now=today();setStatsMonth(now.slice(0,7));setWeekStart(weekBounds(now).start);setTab('overview');}
  function shiftPeriod(delta:number){
    const next=shiftStatsPeriod(statsMonth,weekStart,period,delta);
    if(next){setStatsMonth(next.month);setWeekStart(next.weekStart);}
  }
  const overview=useMemo(()=>spendingOverview(entries,month,weekStart),[entries,month,weekStart]);
  const summary=overview.monthly;
  const ledgerRows=useMemo(()=>filterByConsumption(summary.rows,consumptionFilter),[summary.rows,consumptionFilter]);
  const dailyGroups=useMemo(()=>groupEntriesByDate(ledgerRows),[ledgerRows]);
  const currentMonth=month===today().slice(0,7);
  const year=month.slice(0,4);
  const periodLabel=period==='year'?year+'年':period==='month'?monthLabel(month):overview.week.start.slice(5).replace('-','/')+' — '+overview.week.end.slice(5).replace('-','/');
  const periodUnit=period==='year'?'年':period==='month'?'个月':'周';
  const categoryTotals=period==='year'?overview.yearly.groups:period==='month'?summary.groups:overview.weeklyGroups;
  const periodTotal=period==='year'?overview.yearly.expense:period==='month'?summary.expense:overview.weeklyExpense;
  const disabled=busy||loading||!!notice;
  function confirmDelete(entry:Entry){
    if(disabled)return;
    notify('删除账单','确定删除「'+(entry.note.trim()||entry.category)+'」 ¥ '+money(entry.cents)+'？',[
      {text:'取消',style:'cancel'},
      {text:'删除',style:'destructive',onPress:()=>void mutate(entry,true,entry)}
    ]);
  }
  function showCategory(category:string){
    if(disabled)return;
    setCategoryDetail({category,
      start:period==='year'?year+'-01-01':period==='month'?month+'-01':overview.week.start,
      end:period==='year'?year+'-12-31':period==='month'?month+'-'+daysInMonth(Number(year),Number(month.slice(5))):overview.week.end
    });
  }
  const detailRows=useMemo(()=>categoryDetail?entries.filter(e=>e.kind==='expense'&&e.category===categoryDetail.category&&e.date>=categoryDetail.start&&e.date<=categoryDetail.end):[],[entries,categoryDetail]);
  const detailGroups=useMemo(()=>groupEntriesByDate(detailRows),[detailRows]);
  function entryRow(e:Entry){
    return <Pressable accessibilityRole="button" accessibilityLabel={e.date+' '+[e.note.trim(),e.category].filter(Boolean).join(' · ')+' '+money(e.cents)+'元，点击编辑'} accessibilityHint="长按可修改或删除" accessibilityActions={[{name:'showMenu',label:'修改或删除'}]} onAccessibilityAction={event=>{if(!disabled&&event.nativeEvent.actionName==='showMenu')setActionEntry(e);}} disabled={disabled} key={e.id} onPress={()=>open(e)} onLongPress={()=>{if(!disabled)setActionEntry(e);}} style={({pressed})=>[s.row,pressed&&s.rowPressed]}><View style={s.icon}><Text accessible={false} style={s.categoryEmoji}>{categoryIcons[e.category]||'🧾'}</Text></View><View style={{flex:1,gap:4}}><Text style={s.rowTitle}>{e.note.trim()||e.category}</Text>{(e.consumption||e.kind==='income')&&<Text style={s.muted}>{e.kind==='income'?'收入':e.consumption?consumptionLabels[e.consumption]:''}</Text>}</View><Text style={[s.rowAmount,e.kind==='income'&&s.green]}>{e.kind==='income'?'+':'−'}{displayMoney(e.cents)}</Text><View pointerEvents="none" style={s.rowDivider}/></Pressable>;
  }
  const noteHistory=useMemo(()=>{
    const history:Record<string,string[]>={};
    for(const e of [...entries].reverse()){
      const note=e.note.trim();if(!note)continue;
      const notes=history[e.kind+':'+e.category]??=[];
      if(notes.length<8&&!notes.includes(note))notes.push(note);
    }
    return history;
  },[entries]);
  const pendingNotifications={...notificationState,drafts:flagPossibleDuplicates(notificationState.drafts.filter(draft=>!entries.some(e=>e.id===draft.id)),entries)};
  return <SafeAreaProvider><SafeAreaView style={s.screen}><StatusBar style="dark"/>
    <ScrollView key={tab} contentContainerStyle={[s.content,tab==='overview'&&{gap:12,paddingBottom:20}]} keyboardShouldPersistTaps="handled">
      {tab==='overview'?<>
        <View style={s.statsTop}>
          <View style={s.periodTabs}>{(['year','month','week'] as const).map(p=><Pressable key={p} accessibilityRole="button" accessibilityLabel={p==='year'?'年度分类':p==='month'?'月度分类':'周分类'} accessibilityState={{selected:period===p}} onPress={()=>setPeriod(p)} style={({pressed})=>[s.periodTab,pressed&&{opacity:.6}]}><Text style={[s.tabText,period===p&&s.green]}>{p==='year'?'年':p==='month'?'月':'周'}</Text>{period===p&&<View style={s.tabUnderline}/>}</Pressable>)}</View>
          <Pressable accessibilityRole="button" accessibilityLabel="更多选项" accessibilityState={{expanded:moreOpen}} style={s.moreButton} onPress={()=>setMoreOpen(value=>!value)}><MaterialCommunityIcons name="dots-horizontal" size={22} color="#706B77"/></Pressable>
        </View>
        <View style={s.periodSelector}>
          <Pressable accessibilityRole="button" accessibilityLabel={'上一'+periodUnit} disabled={!shiftStatsPeriod(statsMonth,weekStart,period,-1)} onPress={()=>shiftPeriod(-1)} style={s.moreButton}><MaterialCommunityIcons name="chevron-left" size={22} color="#706B77"/></Pressable>
          <Text accessibilityLabel={period==='week'?overview.week.start+'至'+overview.week.end:periodLabel} style={s.monthTitle}>{periodLabel}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={'下一'+periodUnit} disabled={!shiftStatsPeriod(statsMonth,weekStart,period,1)} onPress={()=>shiftPeriod(1)} style={s.moreButton}><MaterialCommunityIcons name="chevron-right" size={22} color="#706B77"/></Pressable>
        </View>
        <View accessible accessibilityLabel={periodLabel+'支出合计 '+money(periodTotal)+'元'} style={s.statsSummary}><Text style={s.muted}>支出</Text><Text style={s.recordTotal} numberOfLines={1} adjustsFontSizeToFit>¥{displayMoney(periodTotal)}</Text></View>
      </>:<>
        <View style={s.recordSummary}><View style={{flex:1}}><Text style={s.muted}>{currentMonth?'本月支出':monthLabel(month)+'支出'}</Text><Text style={s.recordTotal} numberOfLines={1} adjustsFontSizeToFit>¥{displayMoney(summary.expense)}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={'选择账本月份，当前'+monthLabel(ledgerMonth)} accessibilityHint="打开年月滚轮" style={s.moreButton} onPress={()=>setMonthPicker(true)}><MaterialCommunityIcons name="calendar-blank-outline" size={21} color="#7356AC"/></Pressable></View>
        {summary.income>0&&<View style={s.incomeSummary}><Text style={s.muted}>收入 ¥{displayMoney(summary.income)}</Text><Text style={s.muted}>结余 ¥{displayMoney(summary.balance)}</Text></View>}
      </>}
      {!!notice&&<View style={s.notice}><Text accessibilityRole="alert" style={{color:'#93543E',lineHeight:22}}>{notice}</Text><Pressable accessibilityRole="button" disabled={busy} style={s.navItem} onPress={()=>void refresh()}><Text style={s.green}>重新读取</Text></Pressable>{recoveryAvailable&&<Pressable accessibilityRole="button" accessibilityLabel="恢复本机副本" disabled={busy} style={s.navItem} onPress={()=>notify('恢复本机副本','将恢复到上一次保存前的账本，最近一次修改可能不在其中。恢复后请核对并导出备份。',[{text:'取消',style:'cancel'},{text:'恢复副本',style:'destructive',onPress:()=>void restoreLedger()}])}><Text style={s.green}>恢复本机副本</Text></Pressable>}</View>}
      <FadeView trigger={tab+month+weekStart+period+consumptionFilter}>
      {loading?<ActivityIndicator color="#6652A3" style={{padding:40}}/>:tab==='overview'?<>
        {categoryTotals.length?<View>{categoryTotals.map(([name,total])=><Pressable key={name} accessibilityRole="button" accessibilityLabel={"查看"+name+"账单明细"} accessibilityHint="查看该时段的逐笔账单" disabled={disabled} onPress={()=>showCategory(name)} onLongPress={()=>showCategory(name)} style={({pressed})=>[s.breakdownRow,pressed&&s.rowPressed]}>
          <View style={s.icon}><Text accessible={false} style={s.categoryEmoji}>{categoryIcons[name]||'🧾'}</Text></View>
          <View style={{flex:1,gap:9}}><View style={s.line}><Text style={[s.rowTitle,{flex:1}]}>{name}</Text><Text style={s.tableMoney}>¥{displayMoney(total)}</Text><Text style={s.percentage}>{Math.round(total/periodTotal*100)}%</Text></View><View style={s.track}><View style={[s.bar,{width:(total/periodTotal*100)+'%' as `${number}%`}]}/></View></View>
        </Pressable>)}</View>
        :<View style={s.empty}><Text style={s.heading}>这段时间还没有支出</Text><Button title="记一笔" disabled={disabled} onPress={()=>open()}/></View>}
      </>:<>
        {!!pendingNotifications.drafts.length&&<Pressable accessibilityRole="button" accessibilityLabel="查看待确认消费" style={s.moreAction} onPress={()=>setInbox(true)}><Text style={s.green}>{pendingNotifications.drafts.length} 笔消费待确认 ›</Text></Pressable>}
        <View style={s.filters}>{(['all','emotional','rational'] as const).map(value=><Pressable key={value} accessibilityRole="button" accessibilityState={{selected:consumptionFilter===value}} accessibilityLabel={value==='all'?'全部':consumptionLabels[value]} disabled={busy} onPress={()=>setConsumptionFilter(value)} style={({pressed})=>[s.filter,pressed&&{opacity:.6}]}><Text style={[s.tabText,consumptionFilter===value&&s.green]}>{value==='all'?'全部':consumptionLabels[value]}</Text>{consumptionFilter===value&&<View style={s.tabUnderline}/>}</Pressable>)}</View>
        {dailyGroups.length?dailyGroups.map(group=><View key={group.date} style={s.dayGroup}><View accessibilityLabel={group.date} style={s.dateHeader}>{!!dayLabel(group.date).relative&&<Text style={s.dateTitle}>{dayLabel(group.date).relative}</Text>}<Text style={s.dateText}>{dayLabel(group.date).date}</Text></View>{group.rows.map(entryRow)}</View>):<View style={s.empty}><Text style={s.heading}>{consumptionFilter==='all'?'这个月还没有账单':'这个月还没有这类消费'}</Text><Button title="记一笔" disabled={disabled} onPress={()=>open()}/></View>}

      </>}
      </FadeView>
    </ScrollView>
    <View style={s.nav}>
      <Pressable accessibilityRole="button" accessibilityLabel="账本" accessibilityState={{selected:tab==='ledger'}} style={({pressed})=>[s.navItem,s.navTab,pressed&&{opacity:.6}]} onPress={()=>setTab('ledger')}><MaterialCommunityIcons name="notebook-outline" size={21} color={tab==='ledger'?'#7356AC':'#706B77'}/><Text style={[s.navLabel,tab==='ledger'&&s.green]}>账本</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="＋ 记一笔" disabled={disabled} style={({pressed})=>[s.navItem,s.navTab,disabled&&{opacity:.4},pressed&&{opacity:.7}]} onPress={()=>open()}><View style={s.addCircle}><MaterialCommunityIcons name="plus" size={26} color="#FFFFFF"/></View><Text style={s.navLabel}>记一笔</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="统计" accessibilityState={{selected:tab==='overview'}} style={({pressed})=>[s.navItem,s.navTab,pressed&&{opacity:.6}]} onPress={showStats}><MaterialCommunityIcons name="chart-bar" size={22} color={tab==='overview'?'#7356AC':'#706B77'}/><Text style={[s.navLabel,tab==='overview'&&s.green]}>统计</Text></Pressable>
    </View>
    <Modal visible={monthPicker} transparent animationType="none" onRequestClose={()=>setMonthPicker(false)}>{monthPicker&&<DateWheel mode="month" value={ledgerMonth+'-01'} onCancel={()=>setMonthPicker(false)} onConfirm={date=>{setLedgerMonth(date.slice(0,7));setMonthPicker(false);}}/>}</Modal>

    {feedback&&<View pointerEvents="none" style={s.feedback}><Text accessibilityLiveRegion="polite" style={s.feedbackText}>{feedback.text}</Text></View>}
    <Modal visible={moreOpen&&tab==='overview'} transparent animationType="none" onRequestClose={()=>setMoreOpen(false)}>
      {moreOpen&&tab==='overview'&&<View style={{flex:1}}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭更多选项" style={StyleSheet.absoluteFill} onPress={()=>setMoreOpen(false)}/>
        <SafeAreaView pointerEvents="box-none" style={s.moreMenuLayer}>
          <View style={s.moreMenu}>
            <Pressable accessibilityRole="button" accessibilityLabel="数据管理，导入与导出" style={({pressed})=>[s.moreMenuItem,pressed&&{opacity:.6}]} onPress={()=>{setMoreOpen(false);setDataManager(true);}}><Text style={s.green}>数据管理</Text><Text style={s.muted}>导入 / 导出  ›</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="消费识别" style={({pressed})=>[s.moreMenuItem,pressed&&{opacity:.6}]} onPress={()=>{setMoreOpen(false);setInbox(true);void refreshNotifications();}}><Text style={s.green}>消费识别</Text><Text style={s.muted}>{pendingNotifications.drafts.length?pendingNotifications.drafts.length+' 笔待确认':'微信 / 支付宝'} ›</Text></Pressable>
          </View>
        </SafeAreaView>
      </View>}
    </Modal>
    <Modal visible={!!categoryDetail||!!actionEntry} transparent animationType={reducedMotion===false?'fade':'none'} onRequestClose={()=>{if(!busy){if(actionEntry)setActionEntry(null);else setCategoryDetail(null);}}}>
      <View style={{flex:1}}>
        {categoryDetail&&<SafeAreaView style={s.screen}>
          <View style={s.detailHeader}><View style={{flex:1,gap:6}}><Text style={s.heading}>{categoryIcons[categoryDetail.category]} {categoryDetail.category}</Text><Text style={s.muted}>{categoryDetail.start} — {categoryDetail.end}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="关闭分类明细" style={s.navItem} onPress={()=>setCategoryDetail(null)}><Text style={s.close}>×</Text></Pressable></View>
          <View style={s.detailTotal}><Text style={s.muted}>{detailRows.length} 笔</Text><Text style={s.rowAmount}>¥ {money(detailRows.reduce((sum,e)=>sum+e.cents,0))}</Text></View>
          <ScrollView contentContainerStyle={s.detailContent}>{detailGroups.length?detailGroups.map(group=><View key={group.date} style={s.dayGroup}><Text style={s.dateTitle}>{group.date}</Text>{group.rows.map(entryRow)}</View>):<View style={s.empty}><Text style={s.muted}>暂无账单</Text></View>}</ScrollView>
        </SafeAreaView>}
        {actionEntry&&<View style={s.actionOverlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭账单操作" disabled={busy} style={StyleSheet.absoluteFill} onPress={()=>setActionEntry(null)}/>
          <SafeAreaView edges={['bottom']} style={s.actionSheet}>
            <View style={s.actionHeading}><Text style={[s.rowTitle,{flex:1}]} numberOfLines={2}>{actionEntry.note.trim()||actionEntry.category}</Text><Text style={s.rowAmount}>{actionEntry.kind==='income'?'+':'−'}{money(actionEntry.cents)}</Text></View>
            <Pressable accessibilityRole="button" disabled={disabled} onPress={()=>open(actionEntry)} style={({pressed})=>[s.actionButton,pressed&&s.rowPressed]}><Text style={s.green}>修改</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={disabled} onPress={()=>confirmDelete(actionEntry)} style={({pressed})=>[s.actionButton,pressed&&s.rowPressed]}><Text style={s.destructive}>删除</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={()=>setActionEntry(null)} style={({pressed})=>[s.actionButton,pressed&&s.rowPressed]}><Text style={s.muted}>取消</Text></Pressable>
          </SafeAreaView>
        </View>}
      </View>
    </Modal>
    <Modal visible={editor} animationType="none" onRequestClose={()=>editorBack.current?.()}>{editor&&<EntryEditor entry={editing} initial={initial} noteHistory={noteHistory} id={draftId.current} busy={busy} backAction={editorBack} onClose={()=>{if(!busy)setEditor(false);}} onSave={entry=>void mutate(entry)} onDelete={()=>{if(editing)confirmDelete(editing);}}/>}</Modal>
    <Modal visible={inbox} animationType={reducedMotion===false?'slide':'none'} onRequestClose={()=>setInbox(false)}>{inbox&&<NotificationInbox state={pendingNotifications} error={notificationError} onRefresh={refreshNotifications} onClose={()=>setInbox(false)} onChoose={openDetected}/>}</Modal>
    <Modal visible={dataManager} animationType={reducedMotion===false?'slide':'none'} onRequestClose={()=>{if(!busy)setDataManager(false);}}>{dataManager&&<DataManager entries={entries} blocked={disabled} onClose={()=>{if(!busy)setDataManager(false);}} getEntries={readForTransfer} onImport={importEntries}/>}</Modal>
  </SafeAreaView></SafeAreaProvider>;
}
const s=StyleSheet.create({
  moreButton:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},
  moreMenuLayer:{flex:1,width:'100%',maxWidth:600,alignSelf:'center',alignItems:'flex-end',paddingHorizontal:26,paddingTop:58},
  moreMenu:{width:228,padding:6,backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#E9E4F0',borderRadius:14},
  moreMenuItem:{minHeight:52,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,paddingHorizontal:12,borderRadius:9},

  rowPressed:{backgroundColor:'#F7F4FB'},
  detailHeader:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:24,paddingTop:12,paddingBottom:16},
  detailTotal:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:26,paddingBottom:16,borderBottomWidth:1,borderBottomColor:'#F0EEF4'},
  detailContent:{paddingHorizontal:26,paddingVertical:20,gap:24,paddingBottom:40},
  close:{fontSize:28,color:'#706B77'},
  actionOverlay:{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(39,35,50,0.24)',justifyContent:'flex-end'},
  actionSheet:{backgroundColor:'#FFFFFF',borderTopLeftRadius:22,borderTopRightRadius:22,paddingHorizontal:20,width:'100%',maxWidth:600,alignSelf:'center'},
  actionHeading:{flexDirection:'row',alignItems:'center',gap:20,paddingHorizontal:12,paddingVertical:20},
  actionButton:{minHeight:54,alignItems:'center',justifyContent:'center',borderTopWidth:1,borderTopColor:'#F0EEF4',borderRadius:8},
  destructive:{fontSize:15,fontWeight:'500',color:'#BE514E'},

  statsTop:{flexDirection:'row',alignItems:'center',paddingLeft:44},
  periodTabs:{flex:1,flexDirection:'row',justifyContent:'center'},
  periodTab:{width:60,minHeight:44,alignItems:'center',justifyContent:'center'},
  tabText:{fontSize:13,color:'#706B77',lineHeight:20},
  tabUnderline:{position:'absolute',height:2,width:28,bottom:0,backgroundColor:'#7356AC',borderRadius:1},
  periodSelector:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:12},
  statsSummary:{gap:4,paddingTop:14,paddingBottom:18},
  breakdownRow:{flexDirection:'row',alignItems:'center',gap:12,minHeight:64,paddingVertical:17},
  track:{height:3,backgroundColor:'#EEE8F6',borderRadius:2,overflow:'hidden'},bar:{height:3,backgroundColor:'#9478C1',borderRadius:2},
  percentage:{width:32,textAlign:'right',fontSize:11,color:'#706B77',fontVariant:['tabular-nums']},
  navItem:{minWidth:64,minHeight:44,alignItems:'center',justifyContent:'center'},
  feedback:{position:'absolute',bottom:88,alignSelf:'center',backgroundColor:'#7356AC',paddingHorizontal:18,paddingVertical:11,borderRadius:24,zIndex:5},feedbackText:{fontSize:14,color:'#FFFFFF'},
  moreAction:{alignSelf:'flex-end',flexDirection:'row',alignItems:'center',gap:20,minHeight:48,paddingHorizontal:16,borderRadius:12,backgroundColor:'#F7F6FA'},
  recordSummary:{flexDirection:'row',alignItems:'center',gap:16,paddingTop:16,paddingBottom:8},
  recordTotal:{fontSize:28,fontWeight:'500',color:'#272332',marginTop:6,fontVariant:['tabular-nums']},
  incomeSummary:{flexDirection:'row',gap:18,flexWrap:'wrap'},
  dayGroup:{gap:0},
  dateHeader:{flexDirection:'row',alignItems:'center',paddingTop:14,paddingBottom:6,gap:8},
  dateTitle:{fontSize:13,fontWeight:'500',color:'#272332'},
  dateText:{fontSize:12,color:'#706B77'},
  filters:{flexDirection:'row',justifyContent:'center',marginTop:8,marginBottom:4},
  filter:{flex:1,minHeight:44,alignItems:'center',justifyContent:'center'},
  screen:{flex:1,backgroundColor:'#FFFFFF',width:'100%',maxWidth:600,alignSelf:'center'},
  muted:{fontSize:12,color:'#706B77',lineHeight:18},
  green:{color:'#7356AC',fontWeight:'600'},
  content:{paddingHorizontal:24,paddingTop:8,gap:18,paddingBottom:32},
  line:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12},
  monthTitle:{fontSize:15,fontWeight:'500',color:'#504B59'},
  heading:{fontSize:17,fontWeight:'600',color:'#272332'},
  tableMoney:{fontSize:13,color:'#504B59',fontVariant:['tabular-nums']},
  row:{flexDirection:'row',gap:12,alignItems:'center',minHeight:68,paddingVertical:15},
  rowDivider:{position:'absolute',left:36,right:0,bottom:0,height:1,backgroundColor:'#F3F0F6'},
  icon:{width:24,height:28,alignItems:'center',justifyContent:'center'},
  categoryEmoji:{fontSize:19,lineHeight:26},
  rowTitle:{fontSize:14,fontWeight:'500',color:'#272332'},
  rowAmount:{fontSize:15,fontWeight:'500',color:'#272332',fontVariant:['tabular-nums']},
  empty:{alignItems:'center',paddingVertical:32,gap:14},
  nav:{borderTopWidth:1,borderTopColor:'#F0EEF4',paddingTop:8,paddingBottom:6,paddingHorizontal:24,flexDirection:'row',justifyContent:'space-between',alignItems:'center',backgroundColor:'#FFFFFF'},
  navTab:{flex:1,gap:5,minHeight:64},navLabel:{fontSize:11,color:'#706B77'},
  addCircle:{width:44,height:44,borderRadius:22,backgroundColor:'#7356AC',alignItems:'center',justifyContent:'center'},
  button:{backgroundColor:'#7356AC',borderWidth:1,borderColor:'#7356AC',borderRadius:14,paddingHorizontal:20,paddingVertical:13,minHeight:44,alignItems:'center',justifyContent:'center'},
  buttonText:{color:'#FFFFFF',fontWeight:'500',fontSize:14},
  buttonTextLight:{color:'#7356AC'},
  light:{backgroundColor:'#FFFFFF',borderColor:'#EEEAF4'},
  notice:{color:'#93543E',backgroundColor:'#FFF0E9',padding:14,borderRadius:12,lineHeight:22}
});
