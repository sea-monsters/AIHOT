import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatHotTime} from '../apps/web/app/lib/hot-format.ts';
test('reused hot formatter preserves locale, timezone, midnight and missing/invalid display',()=>{for(const value of [null,'','invalid','2026-01-01T16:00:00Z','2026-03-04T01:02:03Z','2026-10-06T12:00:00Z',...Array.from({length:100},(_,i)=>new Date(1720000000000+i*86400321).toISOString())])assert.equal(formatHotTime(value),value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'暂无')});
