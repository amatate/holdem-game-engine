// Keep paragraph references stable: update volume-one.ts and its route tests when revising this source.
import { readFile, writeFile } from 'node:fs/promises';
const source=await readFile('docs/writing-review-v2/02-夜局第一卷_完整文字稿_v2.md','utf8');
const parts={};
for(const m of source.matchAll(/^### ([NK]\d+(?:\.\d+[a-z]?)?) (.+)\n/gm)){
 const start=m.index+m[0].length,end=source.indexOf('\n### ',start);
 const body=source.slice(start,end<0?undefined:end).split('\n## ')[0];
 parts[m[1]]={title:m[2],blocks:body.split('\n\n').map(p=>p.trim()).filter(Boolean)};
}
await writeFile('src/game/volume-one-text.ts','// Approved Chinese draft, compiled paragraph references. Author notes are never selected for presentation.\nexport const VOLUME_TEXT: Record<string,{title:string;blocks:string[]}> = '+JSON.stringify(parts,null,2)+';\n');
