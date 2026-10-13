/** Dates are metadata update days in UTC+08, matching the SQL expression index. */
export type PaperDateRange={updateStart:string;updateEnd:string};
export function validPaperDay(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'1900-01-01'||value>'9999-12-31')return false;
 const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function paperDateError({updateStart,updateEnd}:PaperDateRange){
 if(!updateStart&&!updateEnd)return '';
 if(!updateStart||!updateEnd)return '请填写完整的开始和结束日期。';
 if(!validPaperDay(updateStart)||!validPaperDay(updateEnd))return '日期无效，请输入 1900–9999 年内真实的年月日。';
 return updateEnd<updateStart?'结束日期不能早于开始日期。':'';
}
export function orderedPaperRange(a:string,b:string):PaperDateRange{return a<=b?{updateStart:a,updateEnd:b}:{updateStart:b,updateEnd:a}}
