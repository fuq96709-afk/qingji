import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from './Motion';
import { daysInMonth, dateFromParts } from './ledger';

const ITEM = 44;
const YEARS = Array.from({length:10000},(_,i)=>i);
const MONTHS = Array.from({length:12},(_,i)=>i+1);

function Wheel({values,value,suffix,onChange}: {values:number[];value:number;suffix:string;onChange:(value:number)=>void}) {
  const list = useRef<FlatList<number>>(null);
  const reported = useRef(value);
  const ready = useRef(false);
  const userScrolling = useRef(false);
  useEffect(()=>{
    if(reported.current===value)return;
    userScrolling.current=false;
    reported.current=value;
    list.current?.scrollToOffset({offset:values.indexOf(value)*ITEM,animated:false});
  },[value,values]);
  function reportOffset(offset:number){
    if(!userScrolling.current)return;
    const index=Math.max(0,Math.min(values.length-1,Math.round(offset/ITEM)));
    if(values[index]!==reported.current){reported.current=values[index];onChange(values[index]);}
  }
  return <View style={s.column}><FlatList ref={list} data={values}
    extraData={value}
    keyExtractor={n=>String(n)} initialScrollIndex={values.indexOf(value)}
    getItemLayout={(_,index)=>({length:ITEM,offset:index*ITEM,index})}
    initialNumToRender={7} windowSize={5} maxToRenderPerBatch={7}
    contentContainerStyle={{paddingVertical:ITEM}}
    style={s.wheel} showsVerticalScrollIndicator={false} bounces={false}
    snapToInterval={ITEM} decelerationRate="fast" scrollEventThrottle={16}
    onContentSizeChange={()=>{
      if(ready.current)return;
      list.current?.scrollToOffset({offset:values.indexOf(value)*ITEM,animated:false});
      ready.current=true;
    }}
    // Native layout and programmatic scroll events must never change the chosen date.
    onScrollBeginDrag={()=>{userScrolling.current=true;}}
    onScroll={event=>reportOffset(event.nativeEvent.contentOffset.y)}
    onScrollEndDrag={event=>reportOffset(event.nativeEvent.contentOffset.y)}
    onMomentumScrollEnd={event=>{reportOffset(event.nativeEvent.contentOffset.y);userScrolling.current=false;}}
    renderItem={({item,index})=><Pressable accessibilityRole="button" accessibilityLabel={String(item)+suffix}
      accessibilityState={{selected:item===value}} style={s.item}
      onPress={()=>{userScrolling.current=false;reported.current=item;onChange(item);list.current?.scrollToOffset({offset:index*ITEM,animated:false});}}>
      <Text style={[s.itemText,item===value&&s.selectedText]}>{suffix==='年'?String(item).padStart(4,'0'):item}{suffix}</Text>
    </Pressable>}/></View>;
}

export default function DateWheel({value,onConfirm,onCancel,mode='date'}: {mode?:'date'|'month';value:string;onConfirm:(date:string)=>void;onCancel:()=>void}) {
  const initial=value.split('-').map(Number);
  const [year,setYear]=useState(initial[0]), [month,setMonth]=useState(initial[1]), [day,setDay]=useState(initial[2]);
  const maximum=daysInMonth(year,month);
  const days=useMemo(()=>Array.from({length:maximum},(_,i)=>i+1),[maximum]);
  const selectedDay=Math.min(day,maximum);
  const selectedDate=dateFromParts(year,month,selectedDay);
  return <BottomSheet label="日期选择" onCancel={onCancel}>{close=><>
      <View style={s.header}><Pressable accessibilityRole="button" onPress={()=>close(onCancel)} style={s.action}><Text style={s.muted}>取消</Text></Pressable><Text style={s.title}>{mode==='month'?'选择月份':'选择日期'}</Text><Pressable accessibilityRole="button" onPress={()=>close(()=>onConfirm(selectedDate))} style={s.action}><Text style={s.confirm}>完成</Text></Pressable></View>
      <View style={s.wheels}><View pointerEvents="none" style={s.focus}/>
        <Wheel values={YEARS} value={year} suffix="年" onChange={y=>{setYear(y);setDay(d=>Math.min(d,daysInMonth(y,month)));}}/>
        <Wheel values={MONTHS} value={month} suffix="月" onChange={m=>{setMonth(m);setDay(d=>Math.min(d,daysInMonth(year,m)));}}/>
        {mode==='date'&&<Wheel key={maximum} values={days} value={selectedDay} suffix="日" onChange={setDay}/>}
      </View>
    </>}
  </BottomSheet>;
}
const s=StyleSheet.create({
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:6},
  action:{minHeight:44,minWidth:54,alignItems:'center',justifyContent:'center'},
  title:{fontSize:16,fontWeight:'600',color:'#272332'},
  muted:{fontSize:12,color:'#706B77'},
  confirm:{fontSize:14,fontWeight:'600',color:'#7356AC'},
  wheels:{flexDirection:'row',height:ITEM*3},
  focus:{position:'absolute',left:0,right:0,top:ITEM,height:ITEM,backgroundColor:'#F3EFF9',borderRadius:10},
  column:{flex:1},wheel:{height:ITEM*3},
  item:{height:ITEM,alignItems:'center',justifyContent:'center'},
  itemText:{fontSize:16,color:'#8B8494'},
  selectedText:{color:'#272332',fontWeight:'600',fontSize:18}
});
