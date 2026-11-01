type EditableSettings={endpoint:string;model:string;protocol:string;reasoning:string;dailyLimit:number;maxTokens:number;enabled:boolean;revision:number};
export function canonicalEndpoint(value:string){return new URL(value).href.replace(/\/+$/,'')}
export function sameEndpoint(a:string,b:string){try{return canonicalEndpoint(a)===canonicalEndpoint(b)}catch{return false}}
/** Only editable settings are sent; usage and other read-only data can grow independently. */
export function settingsPayload(config:EditableSettings,apiKey:string,removeKey:boolean,consent:boolean){
 const {endpoint,model,protocol,reasoning,dailyLimit,maxTokens,enabled,revision}=config;
 return {endpoint,model,protocol,reasoning,dailyLimit,maxTokens,enabled,revision,apiKey:apiKey||undefined,removeKey,confirmedDestination:consent?canonicalEndpoint(endpoint):null};
}
