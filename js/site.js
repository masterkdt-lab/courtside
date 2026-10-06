const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={mode:'private',players:6,partners:2,week:'Feb 7–13',room:'deluxe',tennis:'core',singleRooms:0};
const roomData={deluxe:{name:'Deluxe',cost:0},club:{name:'Club View',cost:175},terrace:{name:'Superior Terrace',cost:250},junior:{name:'Junior Suite',cost:650},royal:{name:'Royal Suite',cost:1100}};
const tennisData={light:{name:'2–3 mornings',cost:0},core:{name:'4 mornings + Eva',cost:0},daily:{name:'Daily tennis',cost:250},custom:{name:'Custom tennis',cost:0}};
function money(n){return '$'+Math.round(n).toLocaleString('en-US')}
function clamp(v,min,max){return Math.min(max,Math.max(min,v))}
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
function refresh(){syncAddonQty();calculate();refreshVetted()}
function enterSite(){ $('#gate').classList.add('gate-out'); $('#site').classList.add('site-live'); localStorage.setItem('ct-spain-entered','1'); setTimeout(()=>$('#gate').classList.add('hidden'),600)}
$('#inviteForm').addEventListener('submit',e=>{e.preventDefault();const code=$('#inviteCode').value.trim().toUpperCase();if(code.length>=4)enterSite();else $('#inviteCode').focus()});
const params=new URLSearchParams(location.search);if(params.get('invite')){const guest=params.get('guest');$('#inviteIntro').textContent=(guest?`Welcome, ${guest}. `:'')+'Katie invited you to The Spanish Offseason. Your private invitation link is recognized — no code needed.';$('#inviteCode').value='INVITED';$('#inviteForm').classList.add('recognized-invite');const b=$('#enterButton');if(b)b.textContent='Enter The Spanish Offseason';}
function setMode(mode,scroll=false){state.mode=mode;$('#privateFlow').classList.toggle('hidden',mode!=='private');$('#vettedFlow').classList.toggle('hidden',mode!=='vetted');$$('.path-toggle-btn').forEach(b=>{const on=b.dataset.mode===mode;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false')});if(scroll)$('#build').scrollIntoView({behavior:'smooth',block:'start'});}
$$('.path-toggle-btn').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode,false)));
$$('.path-jump').forEach(a=>a.addEventListener('click',()=>setMode(a.dataset.path,true)));
$$('#privateWeeks .fixed-week').forEach(w=>w.addEventListener('click',()=>{$$('#privateWeeks .fixed-week').forEach(x=>x.classList.remove('selected'));w.classList.add('selected');state.week=w.querySelector('input').value;refresh()}));
$$('[data-counter]').forEach(b=>b.addEventListener('click',()=>{const key=b.dataset.counter,dir=+b.dataset.dir,min=key==='players'?4:0,max=12;state[key]=clamp(state[key]+dir,min,max);$('#'+key+'Val').textContent=state[key];refresh()}));
$$('#roomOptions .option').forEach(o=>o.addEventListener('click',()=>{$$('#roomOptions .option').forEach(x=>x.classList.remove('selected'));o.classList.add('selected');state.room=o.querySelector('input').value;refresh()}));
$$('#tennisOptions .option').forEach(o=>o.addEventListener('click',()=>{$$('#tennisOptions .option').forEach(x=>x.classList.remove('selected'));o.classList.add('selected');state.tennis=o.querySelector('input').value;refresh()}));
$$('#privateFlow .addon').forEach(card=>{const box=card.querySelector('input[type=checkbox]');box.addEventListener('change',()=>{card.classList.toggle('on',box.checked);refresh()});card.querySelector('.addon-qty input')?.addEventListener('input',refresh)});
$('#singleRooms').addEventListener('change',refresh);
function privateBrief(){const c=calculate();return `THE SPANISH OFFSEASON — PRIVATE GROUP REQUEST\n\nWeek: ${state.week}, 2027 (Sunday–Saturday)\nGroup: ${state.players} tennis players + ${state.partners} non-playing partners\nStay: ${roomData[state.room].name}${state.singleRooms?` · ${state.singleRooms} single-occupancy room(s)`:''}\nTennis: ${tennisData[state.tennis].name}\nAdd-ons: ${c.labels.length?c.labels.join(', '):'None selected'}\nNotes: ${$('#notes').value||'—'}\n\nEstimated tennis-player investment: ${$('#playerRange').textContent}\n${state.partners?$('#partnerRange').textContent+'\n':''}Estimated group total: ${$('#groupRange').textContent}\n\nAirfare not included. Final quote subject to room, tennis and vendor availability.`}
$('#requestBtn').addEventListener('click',()=>{$('#tripBrief').textContent=privateBrief();$('#requestModal').classList.add('open')});
function selectedVals(sel){return $$(sel).filter(x=>x.checked).map(x=>x.value)}
function refreshVetted(){
  const weeks=selectedVals('#vettedFlow .vetted-weeks input'), party=$('#vettedFlow input[name=partyType]:checked')?.value||'Solo', level=$('#vettedLevel').value, tennisStyle=$('#vettedTennisStyle').value, travel=$('#vettedFlow input[name=travelStyle]:checked')?.value||'Balanced', pr=selectedVals('#vettedFlow .priority-grid input');
  $('#vettedWeekSummary').textContent=weeks.length?weeks.join(' · '):'Choose the weeks that work';
  $('#vettedPartySummary').textContent=party;$('#vettedLevelSummary').textContent=level+' · '+tennisStyle;$('#vettedTravelSummary').textContent=travel;$('#vettedPrioritySummary').textContent=pr.length?pr.slice(0,2).join(', ')+(pr.length>2?' +'+(pr.length-2):''):'Tell us what matters';
  $$('#vettedFlow .fixed-week').forEach(w=>w.classList.toggle('selected',!!w.querySelector('input')?.checked));
}
$$('#vettedFlow input, #vettedFlow select').forEach(el=>el.addEventListener('change',refreshVetted));
$$('#partyType .option').forEach(o=>o.addEventListener('click',()=>{$$('#partyType .option').forEach(x=>x.classList.remove('selected'));o.classList.add('selected');refreshVetted()}));
$$('#travelStyle .option').forEach(o=>o.addEventListener('click',()=>{$$('#travelStyle .option').forEach(x=>x.classList.remove('selected'));o.classList.add('selected');refreshVetted()}));
function vettedBrief(){const weeks=selectedVals('#vettedFlow .vetted-weeks input'),party=$('#vettedFlow input[name=partyType]:checked')?.value||'Solo',level=$('#vettedLevel').value,tennisStyle=$('#vettedTennisStyle').value,travel=$('#vettedFlow input[name=travelStyle]:checked')?.value||'Balanced',pr=selectedVals('#vettedFlow .priority-grid input');return `THE SPANISH OFFSEASON — VETTED GROUP REQUEST\n\nWeeks that work: ${weeks.length?weeks.join(', '):'None selected yet'}\nComing as: ${party}\nTennis: ${level} · ${tennisStyle}\nTravel style: ${travel}\nPriorities: ${pr.length?pr.join(', '):'—'}\nWhat Katie should know: ${$('#vettedNotes').value||'—'}\n\nWorking base: from $2,995 per tennis player.\nKatie reviews each request personally and curates around dates, tennis level and group chemistry.`}
$('#vettedRequestBtn').addEventListener('click',()=>{$('#tripBrief').textContent=vettedBrief();$('#requestModal').classList.add('open')});
$('#closeModal').addEventListener('click',()=>$('#requestModal').classList.remove('open'));
$('#requestModal').addEventListener('click',e=>{if(e.target.id==='requestModal')e.currentTarget.classList.remove('open')});
$('#copyBrief').addEventListener('click',async()=>{const txt=state.mode==='vetted'?vettedBrief():privateBrief();try{await navigator.clipboard.writeText(txt);$('#copyBrief').textContent='Copied';setTimeout(()=>$('#copyBrief').textContent='Copy trip brief',1500)}catch(e){$('#copyBrief').textContent='Select + copy below'}});
refresh();setMode('private',false);
