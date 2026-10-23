import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { calculate } from '../src/calculator.ts';
import { parseAmount } from '../src/ledger.ts';
test('计算器遵循乘除优先，十进制运算精确到最后一步',()=>{
  for(const [expression,result] of [['0.1+0.2','0.30'],['2+3×4','14.00'],['20÷4−1.5','3.50'],['1÷3×3','1.00'],['.005','0.01'],['-0.005','-0.01'],['0.004','0.00'],['12+-2','10.00'],['-2×-3','6.00'],['10÷-2+6','1.00'],['99999999.99','99999999.99']]) assert.equal(calculate(expression),result,expression);
  assert.equal(parseAmount(calculate('12.8+6.2')),1900);
});
test('计算器拒绝除零、不完整或危险算式、超限金额，非正结果无法写入账单',()=>{
  for(const expression of ['','1+','1÷0','1..2','1e3','2(3)','alert(1)','1//2','2**3','100000000','9'.repeat(81)])assert.throws(()=>calculate(expression),expression);
  for(const expression of ['1−2','1−1','0.004'])assert.throws(()=>parseAmount(calculate(expression)));
});
