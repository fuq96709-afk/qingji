import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readImport, convertImport, mergeImport, exportBackup, exportCSV, csvTemplate, MAX_FILE_BYTES } from '../src/transfer.ts';
const entry=(overrides={})=>({id:'original',date:'2026-10-14',kind:'expense',cents:2550,category:'餐饮',consumption:'rational',note:'午餐',version:1,...overrides});
const loadCSV=text=>{const file=readImport(text,'账单.csv');return convertImport(file,file.mapping);};
test('完整备份可恢复，包含所有年份与消费类型，旧数组备份也可读取',()=>{
  const rows=[entry(),entry({id:'past',date:'2023-01-01',kind:'income',category:'工资',consumption:undefined,version:2})];
  const backup=readImport(exportBackup(rows),'备份.json');
  assert.deepEqual(backup.entries,JSON.parse(JSON.stringify(rows)));
  assert.deepEqual(readImport(JSON.stringify([entry()]),'旧备份.json').entries,[entry()]);
  for(const text of ['{}','null','{"app":"qingji","version":2,"entries":[]}','{"app":"qingji","version":1,"entries":[null]}'])assert.throws(()=>readImport(text,'备份.json'));
});
test('导出 CSV 中文和金额可往返，正确转义逗号、换行、引号和表格公式',()=>{
  const notes=['午餐,晚餐','第一行\n第二行','他说"谢谢"','=SUM(A1:A2)','  +123','\t文本','\n换行开头',' 原始空格 '];
  const rows=notes.map((note,index)=>entry({id:'id-'+index,note}));
  const csv=exportCSV(rows),result=loadCSV(csv);
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=SUM"));assert.ok(csv.includes('他说""谢谢""'));
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.entries,rows);
});
test('第三方 CSV 识别元金额、时间戳与千分位，未知分类保存原名称，不猜消费类型',()=>{
  const result=loadCSV('日期,类型,金额(元),分类,备注\r\n2026/10/14 18:30:00,支出,"￥1,234.56",外卖,餐费\r\n2026年10月13日,收入,5000,工资,月薪');
  assert.deepEqual(result.errors,[]);assert.equal(result.entries[0].cents,123456);
  assert.equal(result.entries[0].date,'2026-10-14');assert.equal(result.entries[0].category,'其他');
  assert.equal(result.entries[0].note,'原分类：外卖 · 餐费');assert.equal(result.entries[0].consumption,undefined);
  assert.equal(result.uncategorized,1);assert.equal(result.entries[1].kind,'income');
});
test('重复导入跳过已有ID，保留同样内容的多笔真实消费，冲突不覆盖旧账单',()=>{
  const csv='日期,收支,金额,分类,备注\n2026-10-14,支出,10,餐饮,早餐\n2026-10-14,支出,10,餐饮,早餐';
  const first=loadCSV(csv),again=loadCSV(csv);
  assert.equal(first.entries.length,2);assert.notEqual(first.entries[0].id,first.entries[1].id);
  const plan=mergeImport([entry()],first.entries);assert.equal(plan.added,2);
  const repeated=mergeImport(plan.entries,again.entries);assert.equal(repeated.added,0);assert.equal(repeated.duplicates,2);assert.equal(repeated.entries.length,3);
  const conflict=mergeImport([entry()],[entry({cents:9000})]);assert.equal(conflict.conflicts,1);assert.equal(conflict.entries[0].cents,2550);
});
test('制表符、分号与表头前的说明可识别，未识别表头可以手动指定字段',()=>{
  for(const delimiter of ['\t',';']){
    const csv='账单导出说明\n'+['日期','收支','金额'].join(delimiter)+'\n'+['2026-10-14','支出','12.50'].join(delimiter);
    assert.equal(loadCSV(csv).entries[0].cents,1250);
  }
  const file=readImport('发生日,方向,数额\n2026-10-14,支出,3.50','文件.csv');
  assert.ok(convertImport(file,file.mapping).errors.length);
  assert.equal(convertImport(file,{...file.mapping,date:0,kind:1,amount:2}).entries[0].cents,350);
});
test('错误数据会明确报错，零金额、错误千分位、转账与无效日期不会变成其他消费',()=>{
  const errors=loadCSV('日期,收支,金额\n2026-02-30,支出,3\n2026-10-14,支出,0\n2026-10-14,转账,3\n2026-10-14,收入,-3\n2026-10-14,支出,"12,34"');
  assert.equal(errors.entries.length,0);assert.equal(errors.errors.length,5);
  assert.equal(loadCSV('日期,收支,金额\n2026-10-14,支出,-3.25').entries[0].cents,325);
  assert.throws(()=>mergeImport([entry()],[entry({cents:-1})]));
});
test('文件格式、体积和记录数量受限，模板可直接读取',()=>{
  assert.equal(loadCSV(csvTemplate).entries.length,2);
  assert.throws(()=>readImport('','empty.csv'));
  assert.throws(()=>readImport('binary','旧账单.xlsx'));
  assert.throws(()=>readImport('x'.repeat(MAX_FILE_BYTES+1),'huge.csv'));
  assert.throws(()=>readImport('中'.repeat(Math.floor(MAX_FILE_BYTES/3)+1),'huge.csv'));
  assert.throws(()=>readImport('日期,收支,金额\n"2026-10-14,支出,1','bad.csv'));
  assert.throws(()=>readImport('日期,收支,金额\n'+'2026-10-14,支出,1\n'.repeat(10001),'huge.csv'));
  assert.equal(mergeImport([],[]).added,0);
});
test('超过 CSV 笔数限制的完整备份仍可恢复，超大备份不会生成不可恢复的文件',()=>{
  const rows=Array.from({length:10001},(_,i)=>entry({id:'large-'+i}));
  assert.equal(readImport(exportBackup(rows),'备份.json').entries.length,10001);
  const tooLarge=rows.map(e=>({...e,note:'中'.repeat(200)}));
  assert.throws(()=>exportBackup(tooLarge),/5 MB/);
});
