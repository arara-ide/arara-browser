const path = require('node:path');
const os = require('node:os');
const browserRoot = path.resolve(__dirname, '..');
const { chromium } = require('playwright');
delete process.env.ELECTRON_RUN_AS_NODE;
const fs = require('node:fs');
const assert = require('node:assert/strict');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'arara-chatgpt-qa-'));
(async()=> {
 const app=await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || undefined});
 try {
 const page=await app.newPage();
 page.setDefaultTimeout(10000);
 page.on('pageerror', error => console.error('Page error:', error.message));
 for (const unified of [false,true]) {
  const attr=unified?'data-composer-navigation-target="reasoning"':'data-testid="model-switcher-dropdown-button"';
  await page.setContent(`<div hidden><div id="prompt-textarea" contenteditable="true"></div><button data-testid="model-switcher-dropdown-button">Hidden model</button><button data-testid="send-button">Hidden send</button></div><button id="model" ${attr} aria-haspopup="menu" aria-expanded="false">Thinking</button><div id="menu" hidden><button role="menuitemradio">Thinking</button><button role="menuitemradio">Pro</button></div><form data-chatgpt-composer><div id="prompt-textarea" contenteditable="true" role="textbox"></div><button data-testid="send-button" type="button">Send</button></form><div id="answers"></div>`);
  await page.evaluate(()=>{
   window.sendCount=0; window.results=[]; window.progress=[]; window.jobs=[{id:'scan',kind:'models'}];
   window.chrome = {runtime:{onMessage:{addListener(fn){window.contentListener=fn}},sendMessage:async m=>{if(m.type==='ready')return {job:window.jobs.shift()};if(m.type==='result')window.results.push(m);else if(m.type==='progress')window.progress.push(m);return {ok:true}}}};
   const model=document.querySelector('#model'),menu=document.querySelector('#menu');
   model.onclick=()=>{if(model.getAttribute('aria-expanded')==='true'){menu.hidden=true;model.setAttribute('aria-expanded','false')}else{model.setAttribute('aria-expanded','true');setTimeout(()=>menu.hidden=false,window.menuDelay||0)}};
   menu.onkeydown=e=>{if(e.key==='Escape'){menu.hidden=true;model.setAttribute('aria-expanded','false')}};
   menu.onclick=e=>{model.textContent=e.target.textContent;menu.hidden=true;model.setAttribute('aria-expanded','false')};
   document.querySelector('form [data-testid="send-button"]').onclick=()=>{
    window.sendCount=(window.sendCount||0)+1;
    document.querySelector('#answers').insertAdjacentHTML('beforeend','<article><div data-message-author-role="assistant"><div class="markdown">{"text":"Pr</div></div><button data-testid="copy-turn-action-button">Copy</button></article>');
    setTimeout(()=>[...document.querySelectorAll('.markdown')].at(-1).textContent='{"text":"Pronto","toolCalls":[]}',700);
   };
  });
  await page.evaluate(()=>{const model=document.querySelector('#model');model.hidden=true;setTimeout(()=>model.hidden=false,2100)});
  await page.addScriptTag({content:'{'+fs.readFileSync(path.join(browserRoot, 'extension/content.js'),'utf8')+'; window.isJobRunning = () => !!runningJob;}'});
  await page.waitForFunction(()=>window.results.length===1,{},{timeout:10000});
  const models=await page.evaluate(()=>window.results[0].result.models);
  assert.deepEqual(models.map(m=>m.id),['Thinking','Pro']);
  await page.evaluate(()=>{
    window.results=[]; window.menuDelay=1400;
    window.contentListener({type:'job',job:{id:'send',kind:'send',model:'Pro',prompt:'Test prompt'}},{},()=>{});
  });
  await page.waitForFunction(()=>window.results.length===1,{},{timeout:10000});
  const result=await page.evaluate(()=>({result:window.results[0].result,sends:window.sendCount,selected:document.querySelector('#model').innerText,prompt:document.querySelector('form #prompt-textarea').innerText}));
  const progress=await page.evaluate(()=>window.progress.map(m=>m.text));
  assert.ok(progress.includes('{"text":"Pr'));
  assert.ok(progress.includes('{"text":"Pronto","toolCalls":[]}'));
  assert.equal(result.result.text,'{"text":"Pronto","toolCalls":[]}'); assert.equal(result.sends,1); assert.equal(result.selected,'Pro'); assert.equal(result.prompt,'Test prompt');
  await page.evaluate(()=>{window.results=[];window.contentListener({type:'job',job:{id:'rescan',kind:'models'}},{},()=>{})});
  await page.waitForFunction(()=>window.results.length===1);
  assert.deepEqual(await page.evaluate(()=>window.results[0].result.models.map(m=>m.id)),['Pro','Thinking']);
  assert.equal(await page.evaluate(()=>window.sendCount),1);
  await page.evaluate(()=>{
    window.results=[];
    window.contentListener({type:'job',job:{id:'send-2',kind:'send',model:'Thinking',prompt:'Second prompt'}},{},()=>{});
  });
  await page.waitForFunction(()=>window.results.length===1,{},{timeout:10000});
  assert.equal(await page.evaluate(()=>window.results[0].result.text),'{"text":"Pronto","toolCalls":[]}');
  assert.equal(await page.evaluate(()=>window.sendCount),2);
  assert.equal(await page.locator('#answers article').count(),2);
  assert.equal(await page.locator('#model').innerText(),'Thinking');
  // Duplicate delivery must not send the same job again.
  await page.evaluate(()=>window.contentListener({type:'job',job:{id:'send-2',kind:'send',model:'Thinking',prompt:'Duplicate'}},{},()=>{}));
  assert.equal(await page.evaluate(()=>window.sendCount),2);
  // Cancel while waiting for an enabled send button, then accept a fresh job.
  await page.evaluate(()=>{
    window.results=[];
    document.querySelector('form [data-testid="send-button"]').disabled=true;
    window.contentListener({type:'job',job:{id:'cancel-wait',kind:'send',model:'Thinking',prompt:'Must not send'}},{},()=>{});
  });
  await page.waitForFunction(()=>document.querySelector('form #prompt-textarea').innerText==='Must not send');
  await page.evaluate(()=>window.contentListener({type:'cancel',id:'cancel-wait'},{},()=>{}));
  await page.waitForFunction(()=>!window.isJobRunning());
  assert.equal(await page.evaluate(()=>window.sendCount),2);
  assert.equal(await page.evaluate(()=>window.results.length),0);
  await page.evaluate(()=>{
    document.querySelector('form [data-testid="send-button"]').disabled=false;
    window.contentListener({type:'job',job:{id:'after-cancel',kind:'send',model:'Thinking',prompt:'Fresh request'}},{},()=>{});
  });
  await page.waitForFunction(()=>window.results.length===1,{},{timeout:10000});
  assert.equal(await page.evaluate(()=>window.sendCount),3);
  console.log(unified?'Unified picker, hidden controls, duplicate delivery and cancellation: PASS':'Separate picker, hidden controls, duplicate delivery and cancellation: PASS');
 }

 } finally {await app.close(); fs.rmSync(scratch, { recursive: true, force: true });}
})().catch(e=>{console.error(e);process.exitCode=1});
