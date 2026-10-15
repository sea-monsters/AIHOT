import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({root:'qa/formula',plugins:[tailwindcss()],build:{outDir:'../../.formula-preview',emptyOutDir:true},server:{host:'0.0.0.0',port:4177}});
