import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';

export function useReducedMotion(){
  const [reduced,setReduced]=useState<boolean|null>(null);
  useEffect(()=>{
    let active=true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(active)setReduced(value);}).catch(()=>{});
    const listener=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);
    return ()=>{active=false;listener.remove();};
  },[]);
  return reduced;
}
export function FadeView({trigger,children}: {trigger:string;children:React.ReactNode}){
  const reduced=useReducedMotion();
  const [opacity]=useState(()=>new Animated.Value(1));
  useEffect(()=>{
    opacity.stopAnimation();
    if(reduced===null)return;
    if(reduced){opacity.setValue(1);return;}
    opacity.setValue(.65);
    const animation=Animated.timing(opacity,{toValue:1,duration:140,useNativeDriver:Platform.OS!=='web'});
    animation.start();return ()=>animation.stop();
  },[trigger,reduced,opacity]);
  return <Animated.View style={{opacity,gap:18}}>{children}</Animated.View>;
}
export function BottomSheet({children,onCancel,label,dismissible=true}: {children:(close:(action:()=>void)=>void)=>React.ReactNode;onCancel:()=>void;label:string;dismissible?:boolean}){
  const reduced=useReducedMotion();
  const [progress]=useState(()=>new Animated.Value(0));
  const closing=useRef(false);
  useEffect(()=>{
    if(closing.current||reduced===null)return;
    if(reduced){progress.setValue(1);return;}
    progress.setValue(0);
    const animation=Animated.spring(progress,{toValue:1,stiffness:380,damping:38,mass:1,useNativeDriver:Platform.OS!=='web'});
    animation.start();return ()=>animation.stop();
  },[reduced,progress]);
  function close(action:()=>void){
    if(closing.current||!dismissible)return;
    closing.current=true;
    if(reduced){action();return;}
    Animated.timing(progress,{toValue:0,duration:140,easing:Easing.in(Easing.quad),useNativeDriver:Platform.OS!=='web'}).start(({finished})=>{if(finished)action();});
  }
  return <View style={s.overlay} accessibilityViewIsModal>
    <Animated.View style={[s.scrim,{opacity:progress}]}><Pressable style={{flex:1}} accessibilityRole="button" accessibilityLabel={'取消'+label} accessibilityState={{disabled:!dismissible}} disabled={!dismissible} onPress={()=>close(onCancel)}/></Animated.View>
    {/* The render prop attaches close to press handlers; it never calls it during render. */}
    {/* eslint-disable-next-line react-hooks/refs */}
    <Animated.View style={[s.sheet,{opacity:progress,transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[64,0]})}]}]}>{children(close)}</Animated.View>
  </View>;
}
const s=StyleSheet.create({
  overlay:{position:'absolute',top:0,bottom:0,left:0,right:0,zIndex:10,justifyContent:'flex-end'},
  scrim:{position:'absolute',top:0,bottom:0,left:0,right:0,backgroundColor:'rgba(30,23,42,0.16)'},
  sheet:{backgroundColor:'#FFFFFF',borderTopLeftRadius:20,borderTopRightRadius:20,paddingHorizontal:18,paddingBottom:12}
});
