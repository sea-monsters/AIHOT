import {useLayoutEffect} from 'react';
import {profileContentReady} from './performance-profile';
/** DOM commit observation only: excludes later paint and independently loaded reader state. */
export function useContentProfile(data:unknown,label:string){useLayoutEffect(()=>profileContentReady(label),[data,label])}
