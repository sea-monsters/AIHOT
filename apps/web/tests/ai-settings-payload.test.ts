import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {settingsPayload,sameEndpoint} from '../app/lib/ai-settings-payload.ts';
test('settings payload excludes read-only data and normalizes consent destination',()=>{
 const config={endpoint:'https://API.OPENAI.COM:443/v1/',model:'sample-model',protocol:'responses',reasoning:'high',dailyLimit:20,maxTokens:4096,enabled:true,revision:3,usage:'x'.repeat(30000),hasKey:true};
 const body=settingsPayload(config,'FAKE_TEST_CREDENTIAL',false,true);
 assert.equal(body.confirmedDestination,'https://api.openai.com/v1');
 assert.equal('usage' in body,false);assert.equal('hasKey' in body,false);
 assert.ok(JSON.stringify(body).length<1000);
 const retain=settingsPayload(config,'',false,false);assert.equal(retain.apiKey,undefined);assert.equal(retain.confirmedDestination,null);
});
test('all editable fields and revision survive serialization, including empty key retention',()=>{
 const config={endpoint:'https://api.deepseek.com/',model:'custom-model-v2',protocol:'chat_completions',reasoning:'max',dailyLimit:73,maxTokens:65536,enabled:false,revision:42,pricing:{big:'x'.repeat(25000)}};
 const body=JSON.parse(JSON.stringify(settingsPayload(config,'',false,false)));
 assert.deepEqual(body,{endpoint:config.endpoint,model:config.model,protocol:config.protocol,reasoning:config.reasoning,dailyLimit:config.dailyLimit,maxTokens:config.maxTokens,enabled:config.enabled,revision:config.revision,removeKey:false,confirmedDestination:null});
});

test('equivalent endpoint spelling never warns that a retained key belongs to another destination',()=>{
 const saved='https://api.openai.com/v1';
 for(const value of ['https://API.OPENAI.COM:443/v1/','https://api.openai.com/v1///',saved])assert.equal(sameEndpoint(value,saved),true);
 for(const value of ['https://api.openai.com/v2','https://api.deepseek.com','https://api.openai.com/v1?x=1','not a url'])assert.equal(sameEndpoint(value,saved),false);
});
