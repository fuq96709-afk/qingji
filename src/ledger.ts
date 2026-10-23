export type Consumption = 'emotional' | 'rational';
export type Entry = { id: string; kind: 'expense' | 'income'; cents: number; category: string; consumption?: Consumption; note: string; date: string; version: number };
export const consumptionLabels = { emotional: '情绪消费', rational: '理性消费' };
export const categoryGroups = [
  {title:'常用',items:['餐饮','交通','购物','住房','通讯','医疗']},
  {title:'生活',items:['日用','服饰','家居','美容','维修','保险']},
  {title:'休闲',items:['娱乐','运动','旅行','宠物','育儿','人情']},
  {title:'更多',items:['学习','数码','VPN','会员','捐赠','其他']}
];
export const categories = { expense: categoryGroups.flatMap(group=>group.items), income: ['工资', '奖金', '兼职', '其他'] };
export function filterByConsumption(entries: Entry[], filter: 'all' | Consumption | 'unclassified') {
  return filter === 'all' ? entries : entries.filter(e => e.kind === 'expense' && (filter === 'unclassified' ? e.consumption === undefined : e.consumption === filter));
}
export function consumptionTotals(entries: Entry[]) {
  const totals = { all: 0, emotional: 0, rational: 0, unclassified: 0 };
  for (const entry of entries) {
    if (entry.kind !== 'expense') continue;
    totals.all += entry.cents;
    totals[entry.consumption || 'unclassified'] += entry.cents;
  }
  return totals;
}
export function groupEntriesByDate(entries: Entry[]) {
  const ordered = entries.map((entry,index)=>({entry,index})).sort((a,b)=>b.entry.date.localeCompare(a.entry.date)||b.index-a.index);
  const groups: { date: string; rows: Entry[]; expense: number; income: number }[] = [];
  for (const {entry} of ordered) {
    let group = groups[groups.length-1];
    if (!group || group.date !== entry.date) {
      group = { date: entry.date, rows: [], expense: 0, income: 0 }; groups.push(group);
    }
    group.rows.push(entry);
    if (entry.kind === 'expense') group.expense += entry.cents;
    else group.income += entry.cents;
  }
  return groups;
}
export function parseSavedEntries(raw: string | null): Entry[] {
  if (raw === null) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('本机数据格式异常');
  const ids = new Set<string>();
  for (const e of rows) {
    if (!e || typeof e.id !== 'string' || !e.id || ids.has(e.id) ||
      !Number.isSafeInteger(e.cents) || e.cents <= 0 || e.cents > 9999999999 ||
      !['expense', 'income'].includes(e.kind) || typeof e.date !== 'string' || !validDate(e.date) ||
      typeof e.category !== 'string' || !categories[e.kind as Entry['kind']].includes(e.category) ||
      typeof e.note !== 'string' || e.note.length > 200 ||
      (e.consumption !== undefined && (e.kind !== 'expense' || !['emotional','rational'].includes(e.consumption)))) throw new Error('本机数据格式异常');
    ids.add(e.id);
  }
  return rows as Entry[];
}
export function parseAmount(value: string): number {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value.trim())) throw new Error('请输入正确金额，最多两位小数');
  const [whole, fraction = ''] = value.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents <= 0) throw new Error('金额需要大于零');
  return cents;
}
export const money = (cents: number) => (cents / 100).toFixed(2);
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function daysInMonth(year: number, month: number) {
  const first=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-01';
  if (!Number.isInteger(year)||!Number.isInteger(month)||!validDate(first)) throw new Error('无效年月');
  const last=new Date(first+'T12:00:00Z');last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
  return last.getUTCDate();
}
export function dateFromParts(year: number, month: number, day: number) {
  if(!Number.isInteger(day)||day<1||day>31) throw new Error('无效日期');
  const clamped=Math.min(day,daysInMonth(year,month));
  return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(clamped).padStart(2,'0');
}
export function summarize(entries: Entry[], month: string) {
  const rows = entries.filter(e => e.date.startsWith(month));
  const income = rows.filter(e => e.kind === 'income').reduce((s,e) => s+e.cents,0);
  const expense = rows.filter(e => e.kind === 'expense').reduce((s,e) => s+e.cents,0);
  const groups: Record<string, number> = {};
  rows.filter(e => e.kind === 'expense').forEach(e => { groups[e.category] = (groups[e.category] || 0) + e.cents; });
  return { rows: rows.sort((a,b) => b.date.localeCompare(a.date)), income, expense, balance: income-expense, groups: Object.entries(groups).sort((a,b) => b[1]-a[1]) };
}
export function weekBounds(date: string) {
  if (!validDate(date)) throw new Error('无效日期');
  const start = new Date(date + 'T00:00:00Z');
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10) };
}
export function monthWeeks(month: string) {
  if (!validDate(month+'-01')) throw new Error('无效月份');
  const cursor = new Date(weekBounds(month+'-01').start+'T00:00:00Z');
  const last = new Date(month+'-01T00:00:00Z');
  last.setUTCMonth(last.getUTCMonth()+1); last.setUTCDate(0);
  const weeks: ReturnType<typeof weekBounds>[] = [];
  while (cursor <= last) {
    weeks.push(weekBounds(cursor.toISOString().slice(0,10)));
    cursor.setUTCDate(cursor.getUTCDate()+7);
  }
  return weeks;
}
export function spendingOverview(entries: Entry[], month: string, weekDate: string) {
  const yearly = summarize(entries,month.slice(0,4));
  const monthly = summarize(entries,month);
  const week = weekBounds(weekDate);
  const weekly = entries.filter(e=>e.kind==='expense' && e.date>=week.start && e.date<=week.end);
  const weeklyTotals: Record<string,number> = {};
  for (const entry of weekly) weeklyTotals[entry.category]=(weeklyTotals[entry.category]||0)+entry.cents;
  const monthlyTotals = Object.fromEntries(monthly.groups);
  const rows = categories.expense.map(category=>({category,monthly:monthlyTotals[category]||0,weekly:weeklyTotals[category]||0}))
    .filter(row=>row.monthly>0||row.weekly>0).sort((a,b)=>b.monthly-a.monthly||b.weekly-a.weekly);
  const maximum = monthly.groups[0]?.[1] || 0;
  return { yearly, monthly, week, weeklyGroups:Object.entries(weeklyTotals).sort((a,b)=>b[1]-a[1]), weeklyExpense:weekly.reduce((s,e)=>s+e.cents,0), rows,
    leaders: monthly.groups.filter(([,value])=>value===maximum).map(([name])=>name), maximum };
}

/** Move the statistics cursor without changing the ledger's selected month. */
export function shiftStatsPeriod(month: string, weekStart: string, period: 'year'|'month'|'week', delta: number) {
  if (!validDate(month+'-01') || !validDate(weekStart) || !Number.isInteger(delta)) return null;
  if (period === 'week') {
    const cursor = new Date(weekStart+'T12:00:00Z');
    cursor.setUTCDate(cursor.getUTCDate()+delta*7);
    const next=cursor.toISOString().slice(0,10);
    if (!validDate(next)) return null;
    const bounds=weekBounds(next);
    if (!validDate(bounds.start)||!validDate(bounds.end)) return null;
    return {month:next.slice(0,7),weekStart:bounds.start};
  }
  const [year,number]=month.split('-').map(Number);
  const index=year*12+number-1+delta*(period==='year'?12:1);
  const next=String(Math.floor(index/12)).padStart(4,'0')+'-'+String(((index%12)+12)%12+1).padStart(2,'0');
  if (!validDate(next+'-01')) return null;
  const week=weekBounds(next+'-01');
  if (!validDate(week.start)||!validDate(week.end)) return null;
  return {month:next,weekStart:week.start};
}
