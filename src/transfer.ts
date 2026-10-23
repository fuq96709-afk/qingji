import { categories, consumptionLabels, money, parseAmount, parseSavedEntries, validDate } from './ledger.ts';
import type { Entry } from './ledger.ts';

export const MAX_FILE_BYTES=5*1024*1024;
export const MAX_ROWS=10000;
function checkFileSize(text:string){
  let bytes=0;
  for(const char of text){const code=char.codePointAt(0)!;bytes+=code<=0x7f?1:code<=0x7ff?2:code<=0xffff?3:4;if(bytes>MAX_FILE_BYTES)throw new Error('文件超过 5 MB，请分批整理账单');}
}
export const fieldLabels={date:'日期',amount:'金额',kind:'收支',category:'分类',note:'备注',consumption:'消费类型',id:'记录ID'};
export type Field=keyof typeof fieldLabels;
export type Mapping=Record<Field,number>;
export type ImportFile={type:'csv';headers:string[];rows:string[][];mapping:Mapping}|{type:'json';entries:Entry[]};
const aliases:Record<Field,string[]>={date:['日期','时间','交易时间','记账时间','账单日期','date','datetime'],amount:['金额','金额元','交易金额','amount'],kind:['收支','类型','收支类型','收入支出','kind','type'],category:['分类','类别','一级分类','支出分类','用途分类','category'],note:['备注','说明','描述','note','description'],consumption:['消费类型','consumption'],id:['记录id']};
const normalize=(value:string)=>value.trim().toLowerCase().replace(/[\s（）()\[\]：:]/g,'');
const CSV_COLUMNS=['日期','收支','金额（元）','分类','消费类型','备注','记录ID'];
function guessMapping(headers:string[]):Mapping {
  return Object.fromEntries(Object.entries(aliases).map(([field,names])=>[field,headers.findIndex(h=>names.includes(normalize(h)))])) as Mapping;
}
function parseDelimited(text:string,delimiter:string):string[][] {
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
  function endCell(){row.push(cell);cell='';closed=false;}
  function endRow(){endCell();if(row.some(c=>c.trim()))rows.push(row);row=[];if(rows.length>MAX_ROWS+30)throw new Error('一次最多导入 10,000 笔');}
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c===delimiter){endCell();continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;endRow();continue;}
    if(c==='"'){if(cell||closed)throw new Error('表格引号格式不正确');quoted=true;continue;}
    if(closed){if(c===' '||c==='\t')continue;throw new Error('表格引号格式不正确');}
    cell+=c;
  }
  if(quoted)throw new Error('表格中有未闭合的引号');
  if(cell||row.length||closed)endRow();
  return rows;
}
export function readImport(text:string,name:string):ImportFile {
  checkFileSize(text);
  const clean=text.replace(/^\uFEFF/,'').trim();
  if(!clean)throw new Error('文件没有账单');
  if(/\.json$/i.test(name)||clean.startsWith('{')||clean.startsWith('[')){
    let value:unknown;
    try{value=JSON.parse(clean);}catch{throw new Error('备份文件格式不正确');}
    if(!Array.isArray(value)){
      if(!value||typeof value!=='object'||!('app' in value)||value.app!=='qingji'||!('version' in value)||value.version!==1||!('entries' in value))throw new Error('请选择轻记备份文件或 CSV 账单');
      value=value.entries;
    }
    const entries=parseSavedEntries(JSON.stringify(value));
    return {type:'json',entries};
  }
  if(!/\.(csv|tsv|txt)$/i.test(name))throw new Error('目前支持 CSV 表格和轻记 JSON 备份；Excel 文件请先另存为 CSV UTF-8');
  if(clean.includes('\uFFFD'))throw new Error('文件编码无法识别，请另存为 CSV UTF-8');
  // Choose by parsed columns so commas inside quoted notes do not affect detection.
  const candidates=[',','\t',';'].map(delimiter=>{try{return parseDelimited(clean,delimiter);}catch{return [];}});
  const table=candidates.sort((a,b)=>Math.max(0,...b.slice(0,30).map(r=>r.length))-Math.max(0,...a.slice(0,30).map(r=>r.length)))[0];
  if(!table.length)throw new Error('表格格式不正确，请检查引号与分隔符');
  let headerIndex=table.slice(0,30).findIndex(row=>{const m=guessMapping(row);return m.date>=0&&m.amount>=0;});
  if(headerIndex<0)headerIndex=0;
  const headers=table[headerIndex].map(h=>h.trim()),rows=table.slice(headerIndex+1);
  if(headers.length>50)throw new Error('表格列数过多，请保留账单相关列');
  if(rows.length>MAX_ROWS)throw new Error('一次最多导入 10,000 笔');
  if(!rows.length)throw new Error('表格没有账单');
  return {type:'csv',headers,rows,mapping:guessMapping(headers)};
}
function fingerprint(text:string){
  let hash=14695981039346656037n;
  for(let i=0;i<text.length;i++){hash^=BigInt(text.charCodeAt(i));hash=BigInt.asUintN(64,hash*1099511628211n);}
  return hash.toString(16);
}
export function convertImport(file:ImportFile,mapping:Mapping):{entries:Entry[];errors:string[];uncategorized:number} {
  if(file.type==='json')return {entries:file.entries,errors:[],uncategorized:0};
  if(mapping.date<0||mapping.amount<0||mapping.kind<0)return {entries:[],errors:['请为日期、金额和收支选择对应列'],uncategorized:0};
  const entries:Entry[]=[],errors:string[]=[],occurrences=new Map<string,number>();let uncategorized=0;
  const ownExport=file.headers.length===CSV_COLUMNS.length&&file.headers.every((h,i)=>h===CSV_COLUMNS[i]);
  file.rows.forEach((row,index)=>{
    try{
      const get=(field:Field)=>{
        let value=mapping[field]>=0?(row[mapping[field]]||''):'';
        if(ownExport&&/^'(?:\s*[=+\-@]|[\t\r\n])/.test(value))value=value.slice(1);
        return field==='note'||(ownExport&&field==='id')?value:value.trim();
      };
      const match=get('date').match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日)?(?:$|[ T])/);
      const date=match?match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0'):'';
      if(!validDate(date))throw new Error('日期无效');
      const type=get('kind').toLowerCase();
      const kind=['支出','expense','出','付款'].includes(type)?'expense':['收入','income','入','收款'].includes(type)?'income':null;
      if(!kind)throw new Error('收支需要为支出或收入，转账等记录请单独整理');
      let amount=get('amount').replace(/^[¥￥]/,'').trim();
      if(kind==='expense'&&amount.startsWith('-'))amount=amount.slice(1);
      if(amount.includes(',')&&!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(amount))throw new Error('金额分隔符无效，请使用 1234.56 这样的格式');
      amount=amount.replace(/,/g,'');
      const cents=parseAmount(amount);
      const rawCategory=get('category'), knownCategory=categories[kind].includes(rawCategory);
      const category=knownCategory?rawCategory:'其他';
      const note=(rawCategory&&!knownCategory?'原分类：'+rawCategory+' · ':'')+get('note');
      if(note.length>200)throw new Error('备注超过 200 字，请缩短');
      const rawConsumption=get('consumption');
      const consumption=kind==='expense'?(rawConsumption==='情绪消费'||rawConsumption==='emotional'?'emotional':rawConsumption==='理性消费'||rawConsumption==='rational'?'rational':undefined):undefined;
      if(rawConsumption&&!consumption&&kind==='expense')throw new Error('消费类型需为情绪消费或理性消费，也可留空');
      const identity=JSON.stringify([date,kind,cents,category,note,consumption||'']);
      const hash=fingerprint(identity),count=(occurrences.get(identity)||0)+1;occurrences.set(identity,count);
      const id=get('id')||'import-'+hash+'-'+count;
      entries.push({id,kind,cents,date,category,note,version:1,...(consumption?{consumption}:{})});
      if(rawCategory&&!knownCategory)uncategorized++;
    }catch(e){errors.push('第 '+(index+1)+' 笔：'+(e instanceof Error?e.message:'格式不正确'));}
  });
  try{parseSavedEntries(JSON.stringify(entries));}catch{errors.push('记录ID重复或记录格式异常，请检查文件');}
  return {entries,errors,uncategorized};
}
function sameEntry(a:Entry,b:Entry){return a.kind===b.kind&&a.date===b.date&&a.cents===b.cents&&a.category===b.category&&a.note===b.note&&a.consumption===b.consumption;}
export function mergeImport(current:Entry[],incoming:Entry[]){
  parseSavedEntries(JSON.stringify(current));parseSavedEntries(JSON.stringify(incoming));
  const ids=new Map(current.map(e=>[e.id,e]));const added:Entry[]=[];let duplicates=0,conflicts=0;
  for(const entry of incoming){const existing=ids.get(entry.id);if(existing){if(sameEntry(existing,entry))duplicates++;else conflicts++;}else{ids.set(entry.id,entry);added.push(entry);}}
  return {entries:[...current,...added],added:added.length,duplicates,conflicts};
}
export function exportBackup(entries:Entry[]){
  parseSavedEntries(JSON.stringify(entries));
  const text=JSON.stringify({app:'qingji',version:1,exportedAt:new Date().toISOString(),entries});
  checkFileSize(text);
  return text;
}
// Prefix spreadsheet formulas with a quote; the importer reverses it for our text columns.
function csvCell(value:string){const safe=/^\s*[=+\-@]/.test(value)||/^[\t\r\n]/.test(value)?"'"+value:value;return '"'+safe.replace(/"/g,'""')+'"';}
export function exportCSV(entries:Entry[]){
  parseSavedEntries(JSON.stringify(entries));
  return '\uFEFF'+[CSV_COLUMNS,...entries.map(e=>[e.date,e.kind==='expense'?'支出':'收入',money(e.cents),e.category,e.consumption?consumptionLabels[e.consumption]:'',e.note,e.id])].map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export const csvTemplate='\uFEFF日期,收支,金额（元）,分类,消费类型,备注\r\n2026-10-14,支出,25.50,餐饮,理性消费,午餐\r\n2026-10-14,收入,5000.00,工资,,工资\r\n';
