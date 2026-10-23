import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { categories, categoryGroups, parseAmount, validDate, summarize, money, parseSavedEntries, weekBounds, monthWeeks, spendingOverview, filterByConsumption, consumptionTotals, groupEntriesByDate, daysInMonth, dateFromParts, shiftStatsPeriod } from '../src/ledger.ts';
test('金额以整数分保存，拒绝无效输入',()=>{
  assert.equal(parseAmount('0.29'),29);
  assert.equal(parseAmount('12.3'),1230);
  assert.equal(parseAmount('99999999.99'),9999999999);
  assert.equal(money(-29),'-0.29');
  for(const v of ['0','-1','1.999','1e3','NaN','','100000000','1,234']) assert.throws(()=>parseAmount(v));
});
test('本机账本可恢复，损坏记录会报错，避免覆盖原始数据',()=>{
  const entry={id:'a',kind:'expense',cents:29,category:'餐饮',date:'2026-10-14',note:'午餐',version:1};
  assert.deepEqual(parseSavedEntries(null),[]);
  assert.deepEqual(parseSavedEntries(JSON.stringify([entry])),[entry]);
  for(const value of ['','{}','[null]',JSON.stringify([{...entry,cents:0}]),JSON.stringify([{...entry,category:'未知'}]),JSON.stringify([entry,entry])]) assert.throws(()=>parseSavedEntries(value));
});
test('日期校验覆盖闰年和无效月份',()=>{
  assert.equal(validDate('2024-02-29'),true);
  for(const v of ['2025-02-29','2026-13-01','2026-04-31','2026-1-1']) assert.equal(validDate(v),false);
});
test('月度统计排除其他月份，分类只计支出且不改原始列表',()=>{
  const rows=[
    {id:'a',kind:'expense',cents:29,category:'餐饮',date:'2026-10-01',note:'',version:1},
    {id:'b',kind:'income',cents:10000,category:'工资',date:'2026-10-02',note:'',version:1},
    {id:'c',kind:'expense',cents:71,category:'餐饮',date:'2026-10-03',note:'',version:1},
    {id:'d',kind:'expense',cents:500,category:'交通',date:'2026-09-30',note:'',version:1}
  ];
  const result=summarize(rows,'2026-10');
  assert.equal(result.expense,100);assert.equal(result.income,10000);assert.equal(result.balance,9900);
  assert.deepEqual(result.groups,[['餐饮',100]]);assert.equal(result.rows[0].id,'c');assert.equal(rows[0].id,'a');
  assert.equal(summarize(rows,'2026-11').balance,0);
});
test('自然周按周一到周日，跨年和闰月边界计算正确',()=>{
  assert.deepEqual(weekBounds('2026-10-14'),{start:'2026-10-12',end:'2026-10-18'});
  assert.deepEqual(weekBounds('2026-10-18'),{start:'2026-10-12',end:'2026-10-18'});
  assert.deepEqual(weekBounds('2026-10-19'),{start:'2026-10-19',end:'2026-10-25'});
  assert.deepEqual(weekBounds('2027-01-01'),{start:'2026-12-28',end:'2027-01-03'});
  assert.equal(monthWeeks('2024-02').length,5);
  assert.equal(monthWeeks('2026-03').length,6);
  assert.equal(monthWeeks('2026-10')[0].start,'2026-09-28');
  assert.equal(monthWeeks('2026-10').at(-1).end,'2026-11-01');
});
test('分类月合计和完整周合计分别统计，支持并列最多和无支出',()=>{
  const entry=(id,date,category,cents,kind='expense')=>({id,date,category,cents,kind,note:'',version:1});
  const entries=[entry('a','2026-09-30','餐饮',500),entry('b','2026-10-01','餐饮',1000),entry('c','2026-10-04','购物',1000),entry('d','2026-10-05','交通',200),entry('e','2026-10-02','工资',300000,'income')];
  const result=spendingOverview(entries,'2026-10','2026-10-01');
  assert.equal(result.monthly.expense,2200);assert.equal(result.weeklyExpense,2500);
  assert.deepEqual(result.leaders,['餐饮','购物']);assert.equal(result.maximum,1000);
  assert.deepEqual(result.rows,[{category:'餐饮',monthly:1000,weekly:1500},{category:'购物',monthly:1000,weekly:1000},{category:'交通',monthly:200,weekly:0}]);
  assert.deepEqual(spendingOverview(entries,'2026-11','2026-11-15').leaders,[]);
  assert.equal(spendingOverview([], '2026-10','2026-10-14').maximum,0);
});
test('新增用途和消费类型可保存恢复，旧账单保持未选择，收入不混入消费筛选',()=>{
  const base={id:'old',kind:'expense',cents:1000,category:'餐饮',date:'2026-10-14',note:'',version:1};
  const legacy=parseSavedEntries(JSON.stringify([base]))[0];
  assert.equal(legacy.consumption,undefined);
  for(const category of categories.expense){
    for(const consumption of ['emotional','rational']){
      const entry={...base,category,consumption};
      assert.deepEqual(parseSavedEntries(JSON.stringify([entry])),[entry]);
      assert.equal(spendingOverview([entry],'2026-10','2026-10-14').rows[0].monthly,1000);
    }
  }
  const rows=[base,{...base,id:'e',consumption:'emotional'},{...base,id:'r',consumption:'rational'},{...base,id:'i',kind:'income',category:'工资'}];
  assert.equal(filterByConsumption(rows,'all').length,4);
  assert.deepEqual(filterByConsumption(rows,'emotional').map(e=>e.id),['e']);
  assert.deepEqual(filterByConsumption(rows,'rational').map(e=>e.id),['r']);
  assert.deepEqual(filterByConsumption(rows,'unclassified').map(e=>e.id),['old']);
  for(const consumption of ['unknown',null,0])assert.throws(()=>parseSavedEntries(JSON.stringify([{...base,consumption}])));
  assert.throws(()=>parseSavedEntries(JSON.stringify([{...base,kind:'income',category:'工资',consumption:'rational'}])));
});
test('24 个用途分类无重复且各分组包含 6 项',()=>{
  assert.equal(categories.expense.length,24);
  assert.equal(new Set(categories.expense).size,24);
  assert.ok(categoryGroups.every(group=>group.items.length===6));
});
test('年度总额涵盖全部月份，月与自然周各按自己的范围统计，排除收入与其他年份',()=>{
  const expense=(id,date,cents,category='餐饮')=>({id,date,cents,kind:'expense',category,note:'',version:1});
  const entries=[expense('jan','2026-01-01',100),expense('dec','2026-12-31',200,'旅行'),expense('oct','2026-10-14',300),expense('past','2025-10-14',400),expense('next','2027-01-01',500),{...expense('income','2026-10-14',10000),kind:'income',category:'工资'}];
  const overview=spendingOverview(entries,'2026-10','2026-10-14');
  assert.equal(overview.yearly.expense,600);
  assert.equal(overview.yearly.income,10000);
  assert.equal(overview.monthly.expense,300);
  assert.equal(overview.weeklyExpense,300);
  assert.deepEqual(overview.yearly.groups,[['餐饮',400],['旅行',200]]);
  assert.deepEqual(overview.weeklyGroups,[['餐饮',300]]);
  const boundary=spendingOverview(entries,'2026-12','2026-12-31');
  assert.equal(boundary.yearly.expense,600);assert.equal(boundary.weeklyExpense,700);
  assert.equal(spendingOverview(entries,'2028-10','2028-10-14').yearly.expense,0);
});
test('逐日账单按日期倒序，同日最近保存的在前，合计区分收入与消费类型',()=>{
  const entry=(id,date,cents,consumption,kind='expense')=>({id,date,cents,consumption,kind,category:kind==='expense'?'餐饮':'工资',note:'',version:1});
  const entries=[entry('old','2026-10-14',100,'emotional'),entry('past','2026-10-07',400,undefined),entry('income','2026-10-14',10000,undefined,'income'),entry('recent','2026-10-14',200,'rational')];
  const groups=groupEntriesByDate(entries);
  assert.deepEqual(groups.map(g=>g.date),['2026-10-14','2026-10-07']);
  assert.deepEqual(groups[0].rows.map(e=>e.id),['recent','income','old']);
  assert.equal(groups[0].expense,300);assert.equal(groups[0].income,10000);
  assert.deepEqual(consumptionTotals(entries),{all:700,emotional:100,rational:200,unclassified:400});
  assert.equal(entries[0].id,'old');assert.deepEqual(groupEntriesByDate([]),[]);
  assert.equal(groupEntriesByDate(filterByConsumption(entries,'rational'))[0].expense,200);
});
test('滚轮日期正确处理闰年和月份切换，自动限制到有效天数',()=>{
  assert.equal(daysInMonth(2024,2),29);assert.equal(daysInMonth(2025,2),28);
  assert.equal(daysInMonth(2026,4),30);assert.equal(daysInMonth(2026,12),31);
  assert.equal(daysInMonth(9999,12),31);
  assert.equal(dateFromParts(2025,2,31),'2025-02-28');
  assert.equal(dateFromParts(2024,2,31),'2024-02-29');
  assert.equal(dateFromParts(2026,4,31),'2026-04-30');
  assert.equal(dateFromParts(2026,10,14),'2026-10-14');
  for(const args of [[2026,13,1],[2026,0,1],[2026,2,0],[2026,2,32],[2026.5,2,1]]) assert.throws(()=>dateFromParts(...args));
});

test('统计按周可连续跨月跨年，按月年切换不溢出有效日期',()=>{
  assert.deepEqual(shiftStatsPeriod('2026-12','2026-12-28','week',1),{month:'2027-01',weekStart:'2027-01-04'});
  assert.deepEqual(shiftStatsPeriod('2027-01','2027-01-04','week',-1),{month:'2026-12',weekStart:'2026-12-28'});
  assert.equal(shiftStatsPeriod('2026-12','2026-12-28','month',1).month,'2027-01');
  assert.equal(shiftStatsPeriod('2026-01','2025-12-29','month',-1).month,'2025-12');
  assert.equal(shiftStatsPeriod('2024-02','2024-02-26','year',1).month,'2025-02');
  assert.equal(shiftStatsPeriod('9999-12','9999-12-27','year',1),null);
  assert.equal(shiftStatsPeriod('0000-01','0000-01-03','month',-1),null);
});
