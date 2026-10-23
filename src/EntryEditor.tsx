import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { categories, consumptionLabels, money, parseAmount, today, validDate } from './ledger';
import type { Consumption, Entry } from './ledger';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { categoryIcons } from './categoryIcons';
import { calculate } from './calculator';
import DateWheel from './DateWheel';

type Panel='keypad'|'date';
const PURPOSES=['餐饮','购物','日用','交通','运动','娱乐','通讯','服饰','美容','住房','旅行','数码','医疗','学习','宠物','人情','家居','维修','保险','育儿','VPN','会员','捐赠','其他'];
function Tap({label,onPress,selected=false,disabled=false,children}:{label:string;onPress:()=>void;selected?:boolean;disabled?:boolean;children:React.ReactNode}){
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected,disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[s.tap,selected&&s.selected,disabled&&{opacity:.4},pressed&&{opacity:.65}]}>{children}</Pressable>;
}
export default function EntryEditor({entry,initial,noteHistory={},id,busy,onSave,onClose,onDelete,backAction}:{entry:Entry|null;initial?:Pick<Entry,'cents'|'date'|'note'>;noteHistory?:Record<string,string[]>;id:string;busy:boolean;onSave:(entry:Entry)=>void;onClose:()=>void;onDelete:()=>void;backAction:React.RefObject<(()=>void)|null>}){
  const seed=entry||initial;
  const [kind,setKind]=useState<Entry['kind']>(entry?.kind||'expense');
  const [category,setCategory]=useState(entry?.category||'餐饮'),[categoryChosen,setCategoryChosen]=useState(!!entry);
  const [expression,setExpression]=useState(seed?money(seed.cents):''),[replaceAmount,setReplaceAmount]=useState(!!seed);
  const [date,setDate]=useState(seed?.date||today()),[note,setNote]=useState(seed?.note||'');
  const [consumption,setConsumption]=useState<Consumption|undefined>(entry?.consumption);
  const [panel,setPanel]=useState<Panel>('keypad'),[error,setError]=useState('');
  const recentNotes=categoryChosen?(noteHistory[kind+':'+category]||[]):[];
  const [noteEditing,setNoteEditing]=useState(false);
  const noteInput=useRef<TextInput>(null);
  useEffect(()=>{const listener=Keyboard.addListener('keyboardDidHide',()=>{noteInput.current?.blur();setNoteEditing(false);});return ()=>listener.remove();},[]);
  useImperativeHandle(backAction,()=>()=>{if(busy)return;Keyboard.dismiss();if(panel!=='keypad')setPanel('keypad');else if(noteEditing){noteInput.current?.blur();setNoteEditing(false);}else if(!entry&&categoryChosen)setCategoryChosen(false);else onClose();},[busy,panel,noteEditing,entry,categoryChosen,onClose]);
  let result='';try{result=calculate(expression);}catch{}
  function finishNote(){noteInput.current?.blur();setNoteEditing(false);Keyboard.dismiss();}
  function show(next:Panel){finishNote();setPanel(next);setError('');}
  function changeKind(next:Entry['kind']){
    finishNote();
    if(next===kind)return;
    setKind(next);setCategory(categories[next][0]);setCategoryChosen(false);setConsumption(undefined);setError('');
  }
  function press(key:string){
    if(busy)return;setError('');
    if(key==='⌫'){setExpression(expression.slice(0,-1));setReplaceAmount(false);return;}
    const operator=/^[+−]$/.test(key);
    let next=replaceAmount&&!operator?'':expression;
    if(operator){
      if(!next){if(key!=='−')return;}
      else if(/[+−]$/.test(next))next=next.slice(0,-1);
    }
    if(key==='.'){
      const last=next.split(/[+−]/).pop()||'';
      if(last.includes('.'))return;
      if(!last)next+='0';
    }
    if(next.length>=80){setError('算式最多 80 个字符');return;}
    setExpression(next+key);setReplaceAmount(false);
  }
  function save(){
    if(busy)return;
    try{
      const cents=parseAmount(calculate(expression));
      if(!categoryChosen||!categories[kind].includes(category))throw new Error(kind==='expense'?'请选择用途':'请选择收入分类');
      if(!validDate(date))throw new Error('请选择有效日期');
      onSave({id,version:entry?.version||1,kind,category,cents,date,note:note.trim(),...(kind==='expense'&&consumption?{consumption}:{})});
    }catch(e){setError(e instanceof Error?e.message:'请检查账单');}
  }
  function renderKey(key:string){
    if(key==='date')return <Pressable key={key} accessibilityRole="button" accessibilityLabel={'日期，'+(date===today()?'今天':date.replaceAll('-','/'))} disabled={busy} onPress={()=>show('date')} style={({pressed})=>[s.key,pressed&&s.pressed]}><MaterialCommunityIcons name="calendar-month-outline" size={20} color="#7356AC"/><View style={s.dateLabel}>{date!==today()&&<Text style={s.dateKey} numberOfLines={1} adjustsFontSizeToFit>{date.slice(0,4)}</Text>}<Text style={s.dateKey} numberOfLines={1} adjustsFontSizeToFit>{date===today()?'今天':date.slice(5).replace('-','/')}</Text></View></Pressable>;
    if(key==='save')return <Pressable key={key} accessibilityRole="button" accessibilityLabel="保存账单" accessibilityState={{disabled:busy}} disabled={busy} onPress={save} style={({pressed})=>[s.key,s.save,busy&&{opacity:.4},pressed&&s.pressed]}><Text style={s.saveText}>{busy?'保存中…':'完成'}</Text></Pressable>;
    return <Pressable key={key} accessibilityRole="button" accessibilityLabel={key==='⌫'?'退格':key} disabled={busy} onPress={()=>press(key)} style={({pressed})=>[s.key,pressed&&s.pressed]}>{key==='⌫'?<MaterialCommunityIcons name="backspace-outline" size={25} color="#504B59"/>:<Text style={s.keyText}>{key}</Text>}</Pressable>;
  }
  return <SafeAreaView style={s.screen}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
    <View style={{flex:1}} accessibilityElementsHidden={panel!=='keypad'} importantForAccessibility={panel!=='keypad'?'no-hide-descendants':'auto'}>
      <View style={s.header}>
        <View style={{width:56}}>{entry&&<Tap label="删除这笔账" disabled={busy} onPress={onDelete}><Text style={s.delete}>删除</Text></Tap>}</View>
        <View style={s.kinds}>{(['expense','income'] as const).map(k=><Pressable key={k} accessibilityRole="button" accessibilityLabel={k==='expense'?'支出':'收入'} accessibilityState={{selected:kind===k,disabled:busy}} disabled={busy} onPress={()=>changeKind(k)} style={({pressed})=>[s.kindTab,kind===k&&s.kindSelected,pressed&&s.pressed]}><Text style={[s.kindText,kind===k&&{color:'#7356AC'}]}>{k==='expense'?'支出':'收入'}</Text></Pressable>)}</View>
        <Tap label="关闭记账" disabled={busy} onPress={()=>{Keyboard.dismiss();onClose();}}><Text style={s.close}>×</Text></Tap>
      </View>
      <ScrollView style={{flex:1}} contentContainerStyle={s.grid} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {(kind==='expense'?PURPOSES:categories.income).map(c=><Pressable key={c} accessibilityRole="button" accessibilityLabel={c} accessibilityState={{selected:categoryChosen&&category===c,disabled:busy}} disabled={busy} onPress={()=>{finishNote();setCategory(c);setCategoryChosen(true);setError('');}} style={({pressed})=>[s.category,pressed&&s.pressed]}><View style={[s.circle,categoryChosen&&category===c&&s.selectedCircle]}><Text accessible={false} style={s.categoryEmoji}>{categoryIcons[c]}</Text></View><Text style={[s.categoryText,categoryChosen&&category===c&&{color:'#7356AC'}]}>{c}</Text></Pressable>)}
      </ScrollView>
      {categoryChosen&&<View style={s.controls}>
        <View style={s.amountLine}><Text accessibilityLabel={'金额算式 '+(expression||'0')} style={s.expression} numberOfLines={1} adjustsFontSizeToFit>{expression||'0.00'}</Text></View>
        {(!!error||(/[+−]/.test(expression.slice(1))&&!!result))&&<Text accessibilityRole={error?'alert':undefined} accessibilityLiveRegion="polite" style={[s.preview,error&&s.error]}>{error||'= '+result}</Text>}
        <View style={s.noteBar}><Text style={s.noteLabel}>备注：</Text><TextInput ref={noteInput} accessibilityLabel="备注" editable={!busy} value={note} onChangeText={setNote} onFocus={()=>setNoteEditing(true)} onBlur={()=>setNoteEditing(false)} onSubmitEditing={finishNote} returnKeyType="done" maxLength={200} placeholder="点击填写备注" placeholderTextColor="#ADA7B3" style={s.noteValue}/>{noteEditing&&<Tap label="完成备注" disabled={busy} onPress={finishNote}><Text style={s.accent}>完成</Text></Tap>}</View>
        {!!recentNotes.length&&<View style={s.noteHistory}><Text style={s.historyLabel}>最近</Text><ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={s.historyItems}>{recentNotes.map(value=><Pressable key={value} accessibilityRole="button" accessibilityLabel={'使用备注：'+value} disabled={busy} onPress={()=>{setNote(value);finishNote();}} style={({pressed})=>[s.historyChip,pressed&&s.pressed]}><Text style={s.historyText} numberOfLines={1}>{value}</Text></Pressable>)}</ScrollView></View>}
        {!noteEditing&&<>
          {kind==='expense'&&<View style={s.types}>{(['emotional','rational'] as const).map(value=><Pressable key={value} accessibilityRole="button" accessibilityLabel={consumptionLabels[value]} accessibilityState={{selected:consumption===value,disabled:busy}} disabled={busy} onPress={()=>{setConsumption(consumption===value?undefined:value);setError('');}} style={({pressed})=>[s.typeButton,consumption===value&&s.selected,pressed&&s.pressed]}><Text style={consumption===value?s.accent:s.label}>{consumptionLabels[value]}</Text></Pressable>)}</View>}
          <View>{[['7','8','9','date'],['4','5','6','+'],['1','2','3','−'],['.','0','⌫','save']].map((row,index)=><View key={index} style={s.keyRow}>{row.map(renderKey)}</View>)}</View>
        </>}
      </View>}
    </View>
    {panel==='date'&&<DateWheel value={date} onCancel={()=>show('keypad')} onConfirm={value=>{setDate(value);show('keypad');}}/>}
  </KeyboardAvoidingView></SafeAreaView>;
}
const s=StyleSheet.create({
  screen:{flex:1,width:'100%',maxWidth:600,alignSelf:'center',backgroundColor:'#FFFFFF'},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:8,minHeight:54,backgroundColor:'#F8F5FC'},kinds:{flexDirection:'row',gap:14},kindTab:{minWidth:64,minHeight:54,alignItems:'center',justifyContent:'center',borderBottomWidth:2,borderBottomColor:'transparent'},kindSelected:{borderBottomColor:'#7356AC'},kindText:{fontSize:17,fontWeight:'500',color:'#706B77'},
  tap:{minWidth:44,minHeight:44,paddingHorizontal:10,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'transparent',borderRadius:10},selected:{backgroundColor:'#F3EFF9',borderColor:'#DFD4EE'},pressed:{opacity:.6},accent:{fontSize:13,color:'#7356AC',fontWeight:'500'},label:{fontSize:13,color:'#706B77'},close:{fontSize:26,color:'#706B77'},delete:{fontSize:12,color:'#A44747'},
  grid:{flexDirection:'row',flexWrap:'wrap',paddingHorizontal:10,paddingVertical:12},category:{width:'25%',minHeight:84,alignItems:'center',justifyContent:'center',gap:7,paddingVertical:7},circle:{width:50,height:50,borderRadius:25,backgroundColor:'#F6F5F7',alignItems:'center',justifyContent:'center'},selectedCircle:{backgroundColor:'#EADFF7'},categoryEmoji:{fontSize:27,lineHeight:35},categoryText:{fontSize:12,color:'#504B59'},
  controls:{borderTopWidth:1,borderTopColor:'#F2EFF5',backgroundColor:'white'},amountLine:{flexDirection:'row',alignItems:'center',paddingHorizontal:12,minHeight:56,gap:8},expression:{flex:1,fontSize:28,color:'#272332',textAlign:'right',fontVariant:['tabular-nums']},preview:{fontSize:12,color:'#706B77',textAlign:'right',paddingHorizontal:14,paddingBottom:6},error:{color:'#A44747'},
  noteBar:{marginHorizontal:12,marginBottom:4,minHeight:44,borderRadius:5,backgroundColor:'#F8F7FA',flexDirection:'row',alignItems:'center',paddingHorizontal:12},noteLabel:{fontSize:13,color:'#504B59'},noteValue:{flex:1,minWidth:0,minHeight:44,paddingVertical:10,fontSize:13,color:'#504B59'},
  noteHistory:{flexDirection:'row',alignItems:'center',paddingLeft:14,paddingRight:12,marginBottom:4,gap:10},historyLabel:{fontSize:12,color:'#706B77'},historyItems:{gap:7,alignItems:'center'},historyChip:{minHeight:44,maxWidth:160,paddingHorizontal:12,justifyContent:'center',backgroundColor:'#F8F7FA',borderRadius:8},historyText:{fontSize:12,color:'#706B77'},
  types:{flexDirection:'row',justifyContent:'center',gap:10,paddingVertical:4},typeButton:{minHeight:44,paddingHorizontal:18,borderRadius:10,borderWidth:1,borderColor:'transparent',alignItems:'center',justifyContent:'center'},
  keyRow:{flexDirection:'row'},key:{flex:1,minHeight:54,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,borderTopWidth:1,borderRightWidth:1,borderColor:'#F0EEF3',backgroundColor:'#FFFFFF'},keyText:{fontSize:21,color:'#272332'},dateLabel:{flexShrink:1,minWidth:0},dateKey:{fontSize:12,color:'#504B59',textAlign:'center'},save:{backgroundColor:'#7356AC',borderRightWidth:0},saveText:{fontSize:16,fontWeight:'500',color:'white'},
});
