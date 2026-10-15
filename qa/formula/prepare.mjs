// Optional local evidence is never tracked. With no input, the harness uses only synthetic cases.
import {readFile,writeFile} from 'node:fs/promises';
const files=process.argv.slice(2),papers=[];
for(const file of files){const value=JSON.parse(await readFile(file,'utf8'));papers.push(...(Array.isArray(value)?value:value.papers||[]))}
const fields=['id','title','abstract','doi','publisher','journal'];
await writeFile(new URL('./papers.json',import.meta.url),JSON.stringify(papers.map(p=>Object.fromEntries(fields.map(k=>[k,p[k]])))));
try{await readFile(new URL('./real-extra.json',import.meta.url))}catch{await writeFile(new URL('./real-extra.json',import.meta.url),'[]')}
console.log(`Prepared ${papers.length} local-only samples`);
