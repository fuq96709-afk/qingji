type Fraction = { n:bigint; d:bigint };

// Keep fractions exact until the final rounding to cents.
export function calculate(expression:string):string {
  const source=expression.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-').replace(/\s/g,'');
  if(!source||source.length>80)throw new Error('请输入完整算式，最多 80 个字符');
  const tokens=source.match(/(?:\d+(?:\.\d*)?|\.\d+)|[+*/-]/g)||[];
  if(tokens.join('')!==source)throw new Error('算式格式不正确');
  let cursor=0;
  function number():Fraction {
    let sign=1n;
    if(tokens[cursor]==='-'||tokens[cursor]==='+'){if(tokens[cursor]==='-')sign=-1n;cursor++;}
    const token=tokens[cursor++];
    if(!token||! /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token))throw new Error('请输入完整算式');
    const [whole='',part='']=token.split('.');
    return {n:sign*BigInt((whole||'0')+part),d:10n**BigInt(part.length)};
  }
  function term():Fraction {
    let result=number();
    while(tokens[cursor]==='*'||tokens[cursor]==='/'){
      const operator=tokens[cursor++], right=number();
      if(operator==='/'){
        if(right.n===0n)throw new Error('不能除以零');
        result={n:result.n*right.d,d:result.d*right.n};
      }else result={n:result.n*right.n,d:result.d*right.d};
    }
    return result;
  }
  let result=term();
  while(cursor<tokens.length){
    const operator=tokens[cursor++];
    if(operator!=='+'&&operator!=='-')throw new Error('算式格式不正确');
    const right=term();
    result={n:result.n*right.d+(operator==='+'?1n:-1n)*right.n*result.d,d:result.d*right.d};
  }
  const negative=(result.n<0n)!==(result.d<0n);
  const numerator=(result.n<0n?-result.n:result.n)*100n, denominator=result.d<0n?-result.d:result.d;
  const cents=numerator/denominator+(numerator%denominator*2n>=denominator?1n:0n);
  if(cents>9999999999n)throw new Error('金额不能超过 99,999,999.99 元');
  return (negative&&cents!==0n?'-':'')+String(cents/100n)+'.'+String(cents%100n).padStart(2,'0');
}
