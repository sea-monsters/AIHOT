import {AI_TOOL_LIMITS} from '@aihot/contracts/ai-limits';
export {AI_TOOL_LIMITS};
export const jsonBytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Object key order is irrelevant; array order remains significant. Never evaluate model arguments. */
export function canonicalJSON(value:unknown,depth=0):string {
 if(depth>32)throw new Error('Arguments exceed nesting limit');
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(v=>canonicalJSON(v,depth+1)).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON((value as any)[k],depth+1)).join(',')+'}';
}
export type ToolStop='identical_tool_limit'|'same_tool_limit'|'total_tool_limit';
export class ToolGovernor {
 total=0; identical=0; sameTool=0; private lastName=''; private lastKey='';
 /** Inclusive limits: attempts 5/15/200 are admitted; the next disallowed attempt is not. */
 admit(name:string,key:string):ToolStop|null {
  const same=this.lastName===name?this.sameTool+1:1;
  const identical=this.lastName===name&&this.lastKey===key?this.identical+1:1;
  if(this.total>=AI_TOOL_LIMITS.total)return 'total_tool_limit';
  if(identical>AI_TOOL_LIMITS.identicalConsecutive)return 'identical_tool_limit';
  if(same>AI_TOOL_LIMITS.sameToolConsecutive)return 'same_tool_limit';
  this.total++;this.sameTool=same;this.identical=identical;this.lastName=name;this.lastKey=key;return null;
 }
}
export const STOP_TEXT:Record<string,string>={
 identical_tool_limit:'同一工具与相同参数已连续尝试 5 次，下一次重复调用未执行。这是重复调用保护，不代表已判断模型的内部思考状态',
 same_tool_limit:'同一工具已连续尝试 15 次，下一次同工具调用未执行',
 total_tool_limit:'本任务已累计尝试 200 次工具调用，未再执行工具',
 context_limit:'本任务的完整模型输入达到 256 KiB 上下文安全边界，未继续发送模型请求',
 task_memory_limit:'本任务的工具结果与证据达到 2 MiB 安全边界，已停止继续读取',
 round_limit:'本任务已达到 201 次模型轮次安全边界',
 invalid_tool:'供应商返回无法安全配对的工具调用，已停止后续调用',
};
