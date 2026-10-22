import {REMOTE_IMAGES} from './images.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const TRIP_ID='spain';
const state={mode:'private',players:6,partners:2,week:'Feb 7–13',weekId:'w5',room:'deluxe',tennis:'core',singleRooms:0};
const session={code:'',invitedBy:'',issuedTo:''};   // from GET /api/session (plan 5.4)
const catalog={trip:null,weeks:[]};                  // from GET /api/trips (plan 5.5)
let builderClosed=false;                             // true once #build has been replaced by the closed message
const roomData={deluxe:{name:'Deluxe',cost:0},club:{name:'Club View',cost:175},terrace:{name:'Superior Terrace',cost:250},junior:{name:'Junior Suite',cost:650},royal:{name:'Royal Suite',cost:1100}};
const tennisData={light:{name:'2–3 mornings',cost:0},core:{name:'4 mornings + Eva',cost:0},daily:{name:'Daily tennis',cost:250},custom:{name:'Custom tennis',cost:0}};
function money(n){return '$'+Math.round(n).toLocaleString('en-US')}
function clamp(v,min,max){return Math.min(max,Math.max(min,v))}
function reducedMotion(){return matchMedia('(prefers-reduced-motion: reduce)').matches}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function applyRemoteImages(){$$('[data-remote]').forEach(el=>{const url=REMOTE_IMAGES[el.dataset.remote];if(url)el.src=url});$$('[data-remote-bg]').forEach(el=>{const url=REMOTE_IMAGES[el.dataset.remoteBg];if(url)el.style.backgroundImage=`url("${url}")`})}
function syncAddonQty(){const guests=state.players+state.partners;$$('#privateFlow .addon').forEach(card=>{const inp=card.querySelector('.addon-qty input');if(!inp)return;const max=card.dataset.type==='player'?state.players:guests;inp.max=max;if(+inp.value>max||+inp.value<1)inp.value=max;});}
function calculate(){
  state.singleRooms=clamp(+$('#singleRooms').value||0,0,state.players+state.partners);
  const guests=state.players+state.partners, playerBase=2995, partnerBase=1995;
  const room=roomData[state.room], roomPP=room.cost, singlePP=1250;
  let playerSpecific=tennisData[state.tennis].cost, partnerSpecific=0, groupShared=0, addTotal=0, labels=[];
  $$('#privateFlow .addon.on').forEach(card=>{const cost=+card.dataset.cost||0,type=card.dataset.type,label=card.querySelector('strong').textContent;labels.push(label);if(type==='group'){groupShared+=cost;addTotal+=cost}else if(type==='player'){const q=clamp(+(card.querySelector('.addon-qty input')?.value||state.players),1,state.players);addTotal+=cost*q;playerSpecific+=cost*(q/state.players)}else if(type==='guest'){const q=clamp(+(card.querySelector('.addon-qty input')?.value||guests),1,guests);addTotal+=cost*q;const share=q/guests*cost;playerSpecific+=share;partnerSpecific+=share;}});
  const roomTotal=roomPP*guests,singleTotal=singlePP*state.singleRooms,baseTotal=playerBase*state.players+partnerBase*state.partners;
  const total=baseTotal+roomTotal+singleTotal+tennisData[state.tennis].cost*state.players+addTotal;
  const sharedPerGuest=groupShared/Math.max(guests,1),avgSinglePerGuest=singleTotal/Math.max(guests,1);
  const playerEstimate=playerBase+roomPP+playerSpecific+sharedPerGuest+avgSinglePerGuest;
  const partnerEstimate=partnerBase+roomPP+partnerSpecific+sharedPerGuest+avgSinglePerGuest;
  const spread=Math.max(125,playerEstimate*.04),groupSpread=Math.max(300,total*.04);
  $('#playerRange').textContent=money(playerEstimate-spread)+'–'+money(playerEstimate+spread);
  if(state.partners>0){$('#partnerRange').classList.remove('hidden');$('#partnerRange').textContent='Non-playing partner: '+money(partnerEstimate-Math.max(100,partnerEstimate*.04))+'–'+money(partnerEstimate+Math.max(100,partnerEstimate*.04));}else $('#partnerRange').classList.add('hidden');
  $('#groupRange').textContent=money(total-groupSpread)+'–'+money(total+groupSpread);
  $('#summaryDates').textContent=state.week+' · 6 nights';
  $('#summaryGroup').textContent=state.players+' player'+(state.players===1?'':'s')+(state.partners?' + '+state.partners+' partner'+(state.partners===1?'':'s'):'');
  $('#summaryRoom').textContent=room.name+(state.singleRooms?' · '+state.singleRooms+' single room'+(state.singleRooms===1?'':'s'):'');
  $('#summaryTennis').textContent=tennisData[state.tennis].name;
  $('#summaryAddons').textContent=labels.length?labels.slice(0,2).join(', ')+(labels.length>2?' +'+(labels.length-2):''):'None yet';
  return {labels,total,playerEstimate,partnerEstimate};
}
function refresh(){if(builderClosed)return;syncAddonQty();calculate();refreshVetted()}
function setMode(mode,scroll=false){state.mode=mode;if(!builderClosed){$('#privateFlow').classList.toggle('hidden',mode!=='private');$('#vettedFlow').classList.toggle('hidden',mode!=='vetted');$$('.path-toggle-btn').forEach(b=>{const on=b.dataset.mode===mode;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false')})}if(scroll)$('#build').scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'start'});}
$$('.path-toggle-btn').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode,false)));
$$('.path-jump').forEach(a=>a.addEventListener('click',()=>setMode(a.dataset.path,true)));
// Week pickers are re-rendered from /api/trips, so their handlers are delegated to the containers
// (plan 10.6): a chip whose input is disabled (closed week) is ignored.
$('#privateWeeks').addEventListener('click',e=>{const w=e.target.closest('.fixed-week');if(!w||!$('#privateWeeks').contains(w))return;const inp=w.querySelector('input');if(!inp||inp.disabled)return;$$('#privateWeeks .fixed-week').forEach(x=>x.classList.remove('selected'));w.classList.add('selected');inp.checked=true;state.week=inp.dataset.label||inp.value;state.weekId=inp.value;refresh()});
$$('[data-counter]').forEach(b=>b.addEventListener('click',()=>{const key=b.dataset.counter,dir=+b.dataset.dir,min=key==='players'?4:0,max=12;state[key]=clamp(state[key]+dir,min,max);$('#'+key+'Val').textContent=state[key];refresh()}));
$$('#roomOptions .option').forEach(o=>o.addEventListener('click',()=>{$$('#roomOptions .option').forEach(x=>x.classList.remove('selected'));o.classList.add('selected');state.room=o.querySelector('input').value;refresh()}));
$$('#tennisOptions .option').forEach(o=>o.addEventListener('click',()=>{$$('#tennisOptions .option').forEach(x=>x.classList.remove('selected'));o.classList.add('selected');state.tennis=o.querySelector('input').value;refresh()}));
$$('#privateFlow .addon').forEach(card=>{const box=card.querySelector('input[type=checkbox]');box.addEventListener('change',()=>{card.classList.toggle('on',box.checked);refresh()});card.querySelector('.addon-qty input')?.addEventListener('input',refresh)});
$('#singleRooms').addEventListener('change',refresh);
function privateBrief(){const c=calculate();return `THE SPANISH OFFSEASON — PRIVATE GROUP REQUEST\n\nWeek: ${state.week}, 2027 (Sunday–Saturday)\nGroup: ${state.players} tennis players + ${state.partners} non-playing partners\nStay: ${roomData[state.room].name}${state.singleRooms?` · ${state.singleRooms} single-occupancy room(s)`:''}\nTennis: ${tennisData[state.tennis].name}\nAdd-ons: ${c.labels.length?c.labels.join(', '):'None selected'}\nNotes: ${$('#notes').value||'—'}\n\nEstimated tennis-player investment: ${$('#playerRange').textContent}\n${state.partners?$('#partnerRange').textContent+'\n':''}Estimated group total: ${$('#groupRange').textContent}\n\nAirfare not included. Final quote subject to room, tennis and vendor availability.`}
function selectedVals(sel){return $$(sel).filter(x=>x.checked).map(x=>x.value)}
// Vetted week inputs carry value="<weekId>" data-label="<label>": ids go to the API, labels are shown.
function vettedWeekInputs(){return $$('#vettedFlow .vetted-weeks input').filter(x=>x.checked)}
function vettedWeekIds(){return vettedWeekInputs().map(x=>x.value)}
function vettedWeekLabels(){return vettedWeekInputs().map(x=>x.dataset.label||x.value)}
function refreshVetted(){
  if(builderClosed)return;
  const weeks=vettedWeekLabels(), party=$('#vettedFlow input[name=partyType]:checked')?.value||'Solo', level=$('#vettedLevel').value, tennisStyle=$('#vettedTennisStyle').value, travel=$('#vettedFlow input[name=travelStyle]:checked')?.value||'Balanced', pr=selectedVals('#vettedFlow .priority-grid input');
  $('#vettedWeekSummary').textContent=weeks.length?weeks.join(' · '):'Choose the weeks that work';
  $('#vettedPartySummary').textContent=party;$('#vettedLevelSummary').textContent=level+' · '+tennisStyle;$('#vettedTravelSummary').textContent=travel;$('#vettedPrioritySummary').textContent=pr.length?pr.slice(0,2).join(', ')+(pr.length>2?' +'+(pr.length-2):''):'Tell us what matters';
  $$('#vettedFlow .fixed-week').forEach(w=>w.classList.toggle('selected',!!w.querySelector('input')?.checked));
}
$('#vettedFlow').addEventListener('change',refreshVetted);  // delegated: covers re-rendered week checkboxes too
$$('#partyType .option').forEach(o=>o.addEventListener('click',()=>{$$('#partyType .option').forEach(x=>x.classList.remove('selected'));o.classList.add('selected');refreshVetted()}));
$$('#travelStyle .option').forEach(o=>o.addEventListener('click',()=>{$$('#travelStyle .option').forEach(x=>x.classList.remove('selected'));o.classList.add('selected');refreshVetted()}));
function vettedBrief(){const weeks=vettedWeekLabels(),party=$('#vettedFlow input[name=partyType]:checked')?.value||'Solo',level=$('#vettedLevel').value,tennisStyle=$('#vettedTennisStyle').value,travel=$('#vettedFlow input[name=travelStyle]:checked')?.value||'Balanced',pr=selectedVals('#vettedFlow .priority-grid input');return `THE SPANISH OFFSEASON — VETTED GROUP REQUEST\n\nWeeks that work: ${weeks.length?weeks.join(', '):'None selected yet'}\nComing as: ${party}\nTennis: ${level} · ${tennisStyle}\nTravel style: ${travel}\nPriorities: ${pr.length?pr.join(', '):'—'}\nWhat Katie should know: ${$('#vettedNotes').value||'—'}\n\nWorking base: from $2,995 per tennis player.\nKatie reviews each request personally and curates around dates, tennis level and group chemistry.`}

/* ---- session + trips (plan 5.4, 5.5, 4.3) ---- */
const DEFAULT_TRIP_CLOSED='Requests for The Spanish Offseason are closed.';
const DEFAULT_WEEK_CLOSED='Requests for this week are closed.';
const isOpen=w=>w.status==='open';
function weekLabel(id){return catalog.weeks.find(w=>w.weekId===id)?.label||$(`#privateWeeks input[value="${id}"]`)?.dataset.label||id}
function joinList(items){return items.length<=1?items.join(''):items.slice(0,-1).join(', ')+' and '+items[items.length-1]}
function tripClosed(){return !!catalog.trip&&catalog.trip.status!=='open'}
function allWeeksClosed(){return catalog.weeks.length>0&&!catalog.weeks.some(isOpen)}
function closedMessage(){
  if(tripClosed())return catalog.trip.closedMessage||DEFAULT_TRIP_CLOSED;
  if(allWeeksClosed())return catalog.weeks[0].closedMessage||DEFAULT_WEEK_CLOSED;
  return catalog.trip?.closedMessage||DEFAULT_TRIP_CLOSED;
}
function chipHtml(w){const label=esc(w.label),closed=!isOpen(w);return `<span>${esc(String(w.weekId).replace(/^w/i,'W'))}</span><strong>${label}</strong>${closed?'<span class="closed-tag">Closed</span>':''}`}
// Render the ribbon, the private picker and the vetted picker from the weeks array. The static
// seven chips in site.html are only the pre-load fallback. Closed weeks: is-closed, "Closed" tag,
// input disabled. Default stays w5; if the selected week is closed the first open week is chosen.
function renderWeeks(){
  const weeks=catalog.weeks;if(!weeks.length)return;
  const ribbon=$('#join .week-ribbon');
  if(ribbon)ribbon.innerHTML=weeks.map(w=>`<div class="week-chip${isOpen(w)?'':' is-closed'}">${chipHtml(w)}</div>`).join('');
  if(builderClosed)return;
  const priv=$('#privateWeeks');
  if(priv){
    const pick=weeks.find(w=>w.weekId===state.weekId&&isOpen(w))||weeks.find(isOpen)||null;
    priv.innerHTML=weeks.map(w=>{const sel=pick&&w.weekId===pick.weekId;return `<label class="fixed-week${isOpen(w)?'':' is-closed'}${sel?' selected':''}"><input name="privateWeek" type="radio" value="${esc(w.weekId)}" data-label="${esc(w.label)}"${sel?' checked':''}${isOpen(w)?'':' disabled'}/>${chipHtml(w)}</label>`}).join('');
    if(pick){state.weekId=pick.weekId;state.week=pick.label}
  }
  const vet=$('#vettedFlow .vetted-weeks');
  if(vet){
    const keep=new Set(vettedWeekIds());
    vet.innerHTML=weeks.map(w=>{const on=isOpen(w)&&keep.has(w.weekId);return `<label class="fixed-week${isOpen(w)?'':' is-closed'}"><input type="checkbox" value="${esc(w.weekId)}" data-label="${esc(w.label)}"${on?' checked':''}${isOpen(w)?'':' disabled'}/>${chipHtml(w)}</label>`}).join('');
  }
  refresh();
}
// Trip closed, or every week closed: the inside of #build becomes the eyebrow, the h2 and one
// card with the closed message. Nothing else (no toggle, no builder). #build stays the anchor.
function replaceBuilder(message){
  const inner=$('#build .section-inner');if(!inner)return;
  const h2=inner.querySelector(':scope > h2');
  builderClosed=true;
  inner.replaceChildren();
  const eyebrow=document.createElement('div');eyebrow.className='eyebrow';eyebrow.textContent='Choose your path';
  const heading=h2||Object.assign(document.createElement('h2'),{textContent:'How do you want to come?'});
  const card=document.createElement('article');card.className='path-card closed-card';
  const p=document.createElement('p');p.textContent=message;card.append(p);
  inner.append(eyebrow,heading,card);
}
async function loadTrips(){
  let data;
  try{
    const r=await fetch('/api/trips',{credentials:'same-origin'});
    if(r.status===401){location.replace('/invite');return false}
    if(!r.ok)return false;
    data=await r.json();
  }catch(e){return false}
  const trips=Array.isArray(data.trips)?data.trips:[],weeks=Array.isArray(data.weeks)?data.weeks:[];
  catalog.trip=trips.find(t=>t.tripId===TRIP_ID)||trips[0]||null;
  catalog.weeks=weeks.filter(w=>!catalog.trip||w.tripId===catalog.trip.tripId);
  renderWeeks();
  if(!builderClosed&&(tripClosed()||allWeeksClosed()))replaceBuilder(closedMessage());
  return true;
}
async function start(){
  try{
    const r=await fetch('/api/session',{credentials:'same-origin'});
    if(r.status===401){location.replace('/invite');return}
    if(r.ok){const s=await r.json();if(s&&s.ok){session.code=typeof s.code==='string'?s.code:'';session.invitedBy=typeof s.invitedBy==='string'?s.invitedBy:'';session.issuedTo=typeof s.issuedTo==='string'?s.issuedTo:''}}
  }catch(e){/* the server guard already let us in; the modal falls back to the code line */}
  await loadTrips();
  landOnHash();
}
// A pasted /site#build link must land on the builder after the session check (plan 5.14); the
// browser may have scrolled before the page settled, so the hash target is scrolled to once more.
function landOnHash(){const id=decodeURIComponent(location.hash.slice(1));if(!id)return;const el=document.getElementById(id);if(el)el.scrollIntoView({behavior:'instant',block:'start'})}

/* request modal: focus trap while open, Escape closes, focus returns to the opener, #site is inert meanwhile */
const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let modalOpener=null;
function modalFocusables(){return [...$('#requestModal').querySelectorAll(FOCUSABLE)].filter(el=>el.tabIndex>=0&&el.getClientRects().length>0)}   // tabIndex>=0 keeps the honeypot (tabindex=-1) out of the trap
function openModal(opener){modalOpener=opener||document.activeElement;$('#requestModal').classList.add('open');$('#site').setAttribute('inert','');const first=modalFocusables()[0];if(first)first.focus()}
function closeModal(){const m=$('#requestModal');if(!m.classList.contains('open'))return;m.classList.remove('open');$('#site').removeAttribute('inert');if(modalOpener&&document.contains(modalOpener))modalOpener.focus();modalOpener=null}
// The pre-send body is captured from site.html once and rebuilt fresh on every open, so a previous
// success state, consent tick, error or disabled Send never lingers.
const MODAL_TEMPLATE=$('#requestModal .modal-card').innerHTML;
const SEND_LABEL='Send to Katie';
const NETWORK_MESSAGE="Couldn't reach Courtside. Check your connection and try again.";
let sending=false;
function setModalError(text){const el=$('#modalError');if(el)el.textContent=text||''}
function renderPreSend(brief){
  const card=$('#requestModal .modal-card');
  card.innerHTML=MODAL_TEMPLATE;
  sending=false;
  $('#tripBrief').textContent=brief;
  // IDENTITY: the guest's name, email and mobile come from the invite row (one code per guest,
  // set by Katie in the Invites tab), not from form fields. Decision KC 2026-10-05.
  // Alternative, if shared codes are wanted later: collect name/email/mobile (+ consent) in the
  // request modal and validate them here; the Requests columns already exist for them.
  const who=session.issuedTo.trim(),by=session.invitedBy.trim();
  $('#identityLine').textContent=who?`Requesting as ${who}`+(by?` · invited by ${by}`:''):(session.code?`Requesting with code ${session.code}`:'');
}
function renderSuccess({requestId,guestEmailSent}){
  const card=$('#requestModal .modal-card');
  card.replaceChildren();
  const eyebrow=document.createElement('div');eyebrow.className='eyebrow';eyebrow.textContent='Request received';
  const h2=document.createElement('h2');h2.id='modalTitle';h2.tabIndex=-1;h2.textContent="You're on our list.";
  const p=document.createElement('p');p.textContent=`Request ${requestId}. Katie reviews each request personally.`;
  card.append(eyebrow,h2,p);
  if(guestEmailSent===true){const p2=document.createElement('p');p2.textContent='A confirmation email is on its way to the email on your invitation.';card.append(p2)}
  const actions=document.createElement('div');actions.className='modal-actions';
  const close=document.createElement('button');close.type='button';close.className='primary modal-close';close.id='closeModal';close.textContent='Close';
  actions.append(close);card.append(actions);
  h2.focus();
}
function addonQty(card){const inp=card.querySelector('.addon-qty input');const max=card.dataset.type==='player'?state.players:state.players+state.partners;return clamp(+(inp?.value||max),1,max)}
// POST /api/request body (plan 4.4) from the builder state; ids go to the API, labels stay on screen.
function buildRequestBody(){
  const brief=$('#tripBrief').textContent,website=$('#website')?.value||'';
  if(state.mode==='vetted'){
    return {requestType:'vetted',weeks:vettedWeekIds(),partyType:$('#vettedFlow input[name=partyType]:checked')?.value||'Solo',level:$('#vettedLevel').value,tennisStyle:$('#vettedTennisStyle').value,travelStyle:$('#vettedFlow input[name=travelStyle]:checked')?.value||'Balanced',priorities:selectedVals('#vettedFlow .priority-grid input'),note:$('#vettedNotes').value,brief,consent:true,website};
  }
  const addons=$$('#privateFlow .addon.on').map(card=>{const id=card.dataset.id,type=card.dataset.type;return type==='player'||type==='guest'?{id,qty:addonQty(card)}:{id}});
  return {requestType:'private',weeks:[state.weekId],players:state.players,partners:state.partners,room:state.room,singleRooms:state.singleRooms,tennis:state.tennis,addons,note:$('#notes').value,playerEstimate:$('#playerRange').textContent,partnerEstimate:state.partners>0?$('#partnerRange').textContent.replace(/^Non-playing partner:\s*/,''):'',groupEstimate:$('#groupRange').textContent,brief,consent:true,website};
}
function sendFailed(message){sending=false;setModalError(message);const s=$('#sendRequest');if(s){s.disabled=false;s.textContent=SEND_LABEL}}
async function sendRequest(){
  const send=$('#sendRequest'),consent=$('#consent');
  if(!send||sending)return;
  if(!consent||!consent.checked){setModalError('Please agree to the privacy notice to send your request.');return}
  sending=true;send.disabled=true;send.textContent='Sending…';setModalError('');
  const body=buildRequestBody();
  let res,data;
  try{
    res=await fetch('/api/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    data=await res.json().catch(()=>({}));
  }catch(e){sendFailed(NETWORK_MESSAGE);return}
  if(res.status===401){location.replace('/invite');return}
  if(res.ok&&data.ok){sending=false;renderSuccess(data);return}
  if(res.status===400&&data.errors&&typeof data.errors==='object'){sendFailed(Object.values(data.errors).join(' ')||'Please check the request and try again.');return}
  if(res.status===409&&data.reason==='week_closed'){
    const ids=Array.isArray(data.weeks)?data.weeks:[];
    sendFailed(`Requests for ${joinList(ids.map(weekLabel))} are closed.`);
    loadTrips();   // the server caches /api/trips for up to 60 s, so the chips may lag; accepted
    return;
  }
  if(res.status===409&&data.reason==='trip_closed'){
    await loadTrips();
    const message=closedMessage();
    sendFailed(message);
    if(!builderClosed)replaceBuilder(message);   // the modal closes when the user closes it
    return;
  }
  if(res.status===429){sendFailed('Too many requests. Try again in a few minutes.');return}
  sendFailed(NETWORK_MESSAGE);
}
$('#requestBtn').addEventListener('click',e=>{renderPreSend(privateBrief());openModal(e.currentTarget)});
$('#vettedRequestBtn').addEventListener('click',e=>{renderPreSend(vettedBrief());openModal(e.currentTarget)});
// Modal buttons are rebuilt on every open and on success, so their clicks are delegated.
$('#requestModal').addEventListener('click',async e=>{
  if(e.target.id==='requestModal'){closeModal();return}
  const btn=e.target.closest('button');if(!btn)return;
  if(btn.id==='closeModal'){closeModal();return}
  if(btn.id==='sendRequest'){sendRequest();return}
  if(btn.id==='copyBrief'){const txt=$('#tripBrief')?.textContent||'';try{await navigator.clipboard.writeText(txt);btn.textContent='Copied';setTimeout(()=>{if(document.contains(btn))btn.textContent='Copy trip brief'},1500)}catch(err){btn.textContent='Select + copy below'}}
});
document.addEventListener('keydown',e=>{const m=$('#requestModal');if(!m.classList.contains('open'))return;if(e.key==='Escape'){e.preventDefault();closeModal();return}if(e.key!=='Tab')return;const items=modalFocusables();if(!items.length){e.preventDefault();return}const first=items[0],last=items[items.length-1],idx=items.indexOf(document.activeElement);if(e.shiftKey){if(idx<=0){e.preventDefault();last.focus()}}else if(idx===-1||idx===items.length-1){e.preventDefault();first.focus()}});
applyRemoteImages();refresh();setMode('private',false);
start();
