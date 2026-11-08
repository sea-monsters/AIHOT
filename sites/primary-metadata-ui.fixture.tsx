import React from 'react';
import {createRoot} from 'react-dom/client';
import {PaperSelection,PaperCardState} from '../apps/web/app/components/PaperReader';
import {PrimaryMetadataMaintenance} from '../apps/web/app/components/PrimaryMetadataMaintenance';
const papers=Array.from({length:4},(_,i)=>({id:'paper'+i,title:'Fixture '+i}));
export function mount(element:Element){const root=createRoot(element);root.render(<PaperSelection ids={papers.map(p=>p.id)} scopeKey="fixture"><PrimaryMetadataMaintenance papers={papers}/>{papers.map(p=><PaperCardState key={p.id} {...p}>{p.title}</PaperCardState>)}</PaperSelection>);return root;}
