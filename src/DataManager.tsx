import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { money, today } from './ledger';
import type { Entry } from './ledger';
import { convertImport, csvTemplate, exportBackup, exportCSV, fieldLabels, mergeImport, readImport } from './transfer';
import type { Field, ImportFile, Mapping } from './transfer';
import { pickImportFile, saveTransferFile } from './transferFiles';

const EMPTY_MAPPING:Mapping={date:-1,amount:-1,kind:-1,category:-1,note:-1,consumption:-1,id:-1};
function Action({title,onPress,disabled=false,light=false}:{title:string;onPress:()=>void;disabled?:boolean;light?:boolean}){
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[s.action,light&&s.light,disabled&&{opacity:.4},pressed&&{opacity:.8}]}><Text style={[s.actionText,light&&{color:'#7356AC'}]}>{title}</Text></Pressable>;
}
export default function DataManager({entries,blocked,onClose,onImport,getEntries}:{entries:Entry[];blocked:boolean;onClose:()=>void;getEntries:()=>Promise<Entry[]>;onImport:(incoming:Entry[])=>Promise<{added:number;duplicates:number;conflicts:number}>}){
  const [file,setFile]=useState<ImportFile|null>(null),[name,setName]=useState(''),[mapping,setMapping]=useState<Mapping>(EMPTY_MAPPING);
  const [choosing,setChoosing]=useState<Field|null>(null),[working,setWorking]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  const lock=useRef(false);
  const preview=useMemo(()=>file?convertImport(file,mapping):null,[file,mapping]);
  const plan=useMemo(()=>preview&&!preview.errors.length?mergeImport(entries,preview.entries):null,[entries,preview]);
  const totals=useMemo(()=>preview?.entries.reduce((total,e)=>({...total,[e.kind]:total[e.kind]+e.cents}),{expense:0,income:0}),[preview]);
  async function perform(action:()=>Promise<void>){
    if(lock.current)return;lock.current=true;setWorking(true);setError('');setStatus('');
    try{await action();}catch(e){setError(e instanceof Error?e.message:'操作失败，请重试');}
    finally{lock.current=false;setWorking(false);}
  }
  function selectFile(){void perform(async()=>{
    const selected=await pickImportFile();if(!selected)return;
    setFile(null);setChoosing(null);
    const loaded=readImport(selected.text,selected.name);
    setFile(loaded);setName(selected.name);setMapping(loaded.type==='csv'?loaded.mapping:EMPTY_MAPPING);setChoosing(null);
  });}
  function exportFile(format:'json'|'csv'|'template'){void perform(async()=>{
    const current=format==='template'?[]:await getEntries();
    const filename=format==='template'?'轻记-导入模板.csv':'轻记-'+(format==='json'?'备份':'账单')+'-'+today()+'-'+Date.now()+'.'+format;
    await saveTransferFile(filename,format==='template'?csvTemplate:format==='json'?exportBackup(current):exportCSV(current),format==='json'?'application/json':'text/csv');
    setStatus('文件已生成，请在下载列表或系统保存菜单中保存。');
  });}
  function confirmImport(){void perform(async()=>{
    if(!preview||preview.errors.length)throw new Error('请先修正文件中的问题');
    const result=await onImport(preview.entries);
    setStatus('已导入 '+result.added+' 笔 · 跳过重复 '+result.duplicates+' 笔'+(result.conflicts?' · 保留冲突记录 '+result.conflicts+' 笔':''));
    setFile(null);setChoosing(null);
  });}
  const disabled=working||blocked;
  return <SafeAreaView style={s.screen}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <View style={s.line}><Text style={s.title}>数据管理</Text><Action title="关闭" light onPress={onClose}/></View>
    <Text style={s.muted}>本机共 {entries.length} 笔账单</Text>
    <Text style={s.muted}>卸载、清除应用数据或换手机前，请导出备份并保存到应用外。更新时直接覆盖安装。本机恢复副本会随应用数据一起删除，不能替代导出文件。</Text>
    <Text style={s.heading}>导出</Text><View style={s.row}><View style={{flex:1}}><Action title="导出备份" disabled={disabled} onPress={()=>exportFile('json')}/><Text style={s.description}>保存到应用外后，可恢复或换手机</Text></View><View style={{flex:1}}><Action title="导出表格" light disabled={disabled} onPress={()=>exportFile('csv')}/><Text style={s.description}>CSV 格式，方便查看和整理</Text></View></View>
    <Text style={s.heading}>导入</Text><Text style={s.muted}>选择 CSV 账单或轻记备份文件，预览后再确认导入。</Text>
    <Action title={file?'重新选择文件':'选择账单文件'} disabled={disabled} onPress={selectFile}/>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={()=>exportFile('template')} style={s.textAction}><Text style={s.accent}>下载导入模板</Text></Pressable>
    {working&&<ActivityIndicator color="#7356AC"/>}
    {blocked&&<Text style={s.error}>账本暂时无法读写，请关闭此页，点击账本提示中的“重新读取”后重试。</Text>}
    {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {!!status&&<Text accessibilityLiveRegion="polite" style={s.status}>{status}</Text>}
    {file&&<>
      <Text style={s.heading}>{name}</Text>
      {file.type==='csv'&&<><Text style={s.muted}>核对文件中的对应列。日期、金额和收支为必选。</Text>
        {(Object.keys(fieldLabels).filter(f=>f!=='id') as Field[]).map(field=><View key={field}>
          <Pressable accessibilityRole="button" accessibilityLabel={'设置'+fieldLabels[field]+'列'} accessibilityState={{expanded:choosing===field,disabled}} disabled={disabled} onPress={()=>setChoosing(choosing===field?null:field)} style={s.mapping}><Text style={s.text}>{fieldLabels[field]}{['date','amount','kind'].includes(field)?' *':''}</Text><Text style={[s.accent,{flex:1,textAlign:'right'}]}>{mapping[field]>=0?file.headers[mapping[field]]||'第 '+(mapping[field]+1)+' 列':'未选择'}  ›</Text></Pressable>
          {choosing===field&&<View style={s.options}>{[-1,...file.headers.map((_,i)=>i)].map(index=><Action key={index} title={index<0?'不使用':(index+1)+'. '+(file.headers[index]||'未命名')} light={mapping[field]!==index} onPress={()=>{setMapping({...mapping,[field]:index});setChoosing(null);}}/>)}</View>}
        </View>)}
      </>}
      {preview&&<>
        <Text style={s.heading}>导入预览 · {preview.entries.length} 笔</Text>
        <View style={s.summary}><Text style={s.text}>支出 ¥ {money(totals?.expense||0)}</Text><Text style={s.text}>收入 ¥ {money(totals?.income||0)}</Text></View>
        {preview.uncategorized>0&&<Text style={s.muted}>{preview.uncategorized} 笔原分类归入“其他”，原名称保留在备注。</Text>}
        {preview.entries.slice(0,5).map((e,index)=><View key={index} style={s.previewRow}><View style={{flex:1,gap:4}}><Text style={s.text}>{e.date} · {e.category}</Text><Text style={s.muted} numberOfLines={2}>{e.note||'无备注'}</Text></View><Text style={s.text}>{e.kind==='expense'?'−':'+'}{money(e.cents)}</Text></View>)}
        {preview.entries.length>5&&<Text style={s.muted}>仅展示前 5 笔，核对通过后导入全部记录。</Text>}
        {!!preview.errors.length&&<View style={s.errorBox}><Text style={s.error}>发现 {preview.errors.length} 个问题，请修正后重新选择文件。</Text>{preview.errors.slice(0,5).map((issue,index)=><Text key={index} style={s.error}>{issue}</Text>)}</View>}
        {plan&&<Text style={s.muted}>新增 {plan.added} 笔 · 跳过重复 {plan.duplicates} 笔{plan.conflicts?' · '+plan.conflicts+' 笔冲突保留现有记录':''}</Text>}
        <Action title={plan?.added?'确认导入 '+plan.added+' 笔':'确认导入'} disabled={disabled||!plan?.added||!!preview.errors.length} onPress={confirmImport}/>
      </>}
    </>}
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({
  screen:{flex:1,backgroundColor:'white',maxWidth:600,width:'100%',alignSelf:'center'},content:{padding:26,gap:16,paddingBottom:40},
  line:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},row:{flexDirection:'row',gap:12},
  title:{fontSize:23,fontWeight:'600',color:'#272332'},heading:{fontSize:17,fontWeight:'600',color:'#272332',marginTop:8},text:{fontSize:14,color:'#504B59'},muted:{fontSize:12,color:'#706B77',lineHeight:19},accent:{fontSize:13,color:'#7356AC'},
  description:{fontSize:12,color:'#706B77',lineHeight:18,marginTop:8},
  action:{minHeight:44,borderRadius:12,borderWidth:1,borderColor:'#7356AC',backgroundColor:'#7356AC',paddingHorizontal:14,paddingVertical:12,alignItems:'center',justifyContent:'center'},actionText:{fontSize:14,fontWeight:'500',color:'white'},light:{backgroundColor:'white',borderColor:'#EEEAF4'},
  textAction:{minHeight:44,justifyContent:'center'},mapping:{flexDirection:'row',justifyContent:'space-between',gap:12,paddingVertical:14,borderBottomWidth:1,borderBottomColor:'#F0EEF4'},options:{flexDirection:'row',flexWrap:'wrap',gap:8,paddingVertical:8},
  summary:{backgroundColor:'#F7F6FA',padding:14,borderRadius:12,gap:8},previewRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12,borderBottomWidth:1,borderBottomColor:'#F0EEF4'},
  error:{fontSize:13,color:'#A44747',lineHeight:20},errorBox:{backgroundColor:'#FFF3F3',padding:14,borderRadius:12,gap:6},status:{fontSize:14,color:'#7356AC',lineHeight:22,backgroundColor:'#F3EFF9',padding:14,borderRadius:12}
});
