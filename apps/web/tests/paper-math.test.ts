import assert from 'node:assert/strict';
import {test} from 'node:test';
import {splitPaperMath,MATH_LIMITS} from '../app/lib/paper-math.ts';
const math=(s:string)=>splitPaperMath(s).filter(p=>p.kind!=='text');
test('recognizes four explicit delimiters without changing source',()=>{for(const s of [String.raw`a $x^2$ b`,String.raw`a $$x^2$$ b`,String.raw`a \(x^2\) b`,String.raw`a \[x^2\] b`]){assert.equal(math(s).length,1);assert.equal(splitPaperMath(s).map(p=>p.raw).join(''),s)}});
test('leaves prices, escaped dollars, code and incomplete source alone',()=>{for(const s of ['$5 and $10','US$20 to US$30',String.raw`\$x\$`,'`$x^2$`','```tex\n$x$\n```',String.raw`\(x^2`,'$x^2','2 × 1012 cm–2','PbTiO 3'])assert.equal(math(s).length,0,s)});
test('bounds inputs and token count, keeps exact fallback text',()=>{for(const s of ['a'.repeat(MATH_LIMITS.text+1),String.raw`\(`+'x'.repeat(MATH_LIMITS.formula+1)+String.raw`\)`,Array(200).fill('$x$').join(' ')]){const p=splitPaperMath(s);assert.ok(math(s).length<=MATH_LIMITS.count);assert.equal(p.map(p=>p.raw).join(''),s)}});
test('JATS TeX CDATA and entities preserve explicit source without guessing',()=>{const p=math('<inline-formula><tex-math><![CDATA[\\alpha + \\beta]]></tex-math></inline-formula>')[0];assert.equal(p.kind,'tex');if(p.kind==='tex')assert.equal(p.value,String.raw`\alpha + \beta`);const q=math('<tex-math>a &lt; b</tex-math>')[0];if(q.kind==='tex')assert.equal(q.value,'a < b')});
test('MathML is identified, never interpreted as HTML by tokenization',()=>{const s='<mml:math><mml:msup><mml:mi>x</mml:mi><mml:mn>2</mml:mn></mml:msup></mml:math>';assert.deepEqual(math(s),[{kind:'mathml',raw:s,value:s}])});
test('streaming replacement does not invent closing delimiters',()=>{assert.equal(math(String.raw`a \(\frac{a}`).length,0);assert.equal(math(String.raw`a \(\frac{a}{b}\)`).length,1)});

test('TeX engine fails closed and never trusts input or shares macros',async()=>{
 const {renderPaperMath}=await import('../app/lib/paper-math-engine.ts');
 const render=(value:string)=>renderPaperMath({kind:'tex',raw:value,value,display:false});
 assert.match(render(String.raw`\frac{a}{b}`)||'',/katex/);
 for(const s of [String.raw`\href{javascript:alert(1)}{x}`,String.raw`\includegraphics{https://evil.invalid/x}`,String.raw`\htmlStyle{position:fixed}{x}`,String.raw`\def\a{\a}\a`,String.raw`\notARealMacro{x}`,String.raw`\frac{1}{`])assert.equal(render(s),null,s);
 assert.doesNotMatch(render(String.raw`\rule{999999em}{999999em}`)||'',/(?:width|height):999999em/);
 assert.equal(render(String.raw`\a`),null);
});
test('explicit adjacent subscripts are supported, HTML code is untouched',()=>{assert.equal(math('Ga$_2$O$_3$').length,2);assert.equal(math('<code>$x$</code>').length,0);assert.equal(math('$20$').length,0)});
test('JATS wrappers with prose or multiple formulas fall back as one unchanged source',()=>{for(const s of ['<inline-formula>before<tex-math>x</tex-math>after<tex-math>y</tex-math></inline-formula>','<inline-formula><alternatives><tex-math>x</tex-math><math><mi>x</mi></math></alternatives></inline-formula>'])assert.deepEqual(splitPaperMath(s),[{kind:'text',raw:s}]);const s='<inline-formula><math><mi>x</mi></math></inline-formula>';assert.deepEqual(math(s),[{kind:'mathml',raw:s,value:'<math><mi>x</mi></math>'}])});
test('currency prefix does not consume following formula and CDATA is not entity decoded',()=>{assert.equal(math('$5 and $x^2$').length,1);const p=math('<tex-math><![CDATA[a &lt; b]]></tex-math>')[0];assert.equal(p.kind,'tex');if(p.kind==='tex')assert.equal(p.value,'a &lt; b')});
