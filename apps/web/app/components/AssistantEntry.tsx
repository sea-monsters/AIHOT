import {openAI} from '../lib/ai-client';
import {IconMessage} from './icons';
export function AssistantEntry({mobile=false}:{mobile?:boolean}){return <button type="button" data-ai-entry className={mobile?'assistant-entry-mobile':'assistant-entry-sidebar'} onClick={()=>openAI('')} aria-haspopup="dialog" aria-label="打开 HKIS AI 助手"><IconMessage size={mobile?21:19}/><span>{mobile?'助手':'Agent 对话'}</span>{!mobile&&<small>论文检索与分析</small>}</button>}
