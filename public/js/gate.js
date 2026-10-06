// Invitation gate (index.html). The site itself lives on /site (site.html, js/site.js).
// POST /api/code validates the code and sets the HttpOnly cs_session cookie (plan 4.4);
// on 200 the gate fades out and navigates to /site. No code ever appears in this file.
const $=s=>document.querySelector(s);
const form=$('#inviteForm'),input=$('#inviteCode'),button=$('#enterButton'),message=$('#inviteMessage'),card=$('.invite-card'),intro=$('#inviteIntro');
const originalIntro=intro.textContent,originalButton=button.textContent;

const MESSAGES={
  idle:'Your code is in your invitation from Katie.',
  checking:'Checking your invitation…',
  invalid:"We couldn't find that invitation. Check the code and try again.",
  paused:'This invitation is paused. Reach out to Katie.',
  used_up:'This invitation has already been used.',
  rate_limited:'Too many attempts. Try again in a few minutes.',
  missing_code:'Enter your invitation code.',
  network:"Couldn't reach Courtside. Try again."
};

function setMessage(text,isError=false){message.textContent=text;message.classList.toggle('is-error',isError)}

// Any failure: show the reason, re-enable the button, make the input visible again (a personal
// link may have hidden it) and focus it.
function fail(reason){
  setMessage(MESSAGES[reason]||MESSAGES.network,true);
  button.disabled=false;
  if(card.classList.contains('recognized-invite')){card.classList.remove('recognized-invite');intro.textContent=originalIntro;button.textContent=originalButton}
  input.focus();
}

function enterSite(issuedTo){
  setMessage(issuedTo?`Welcome, ${issuedTo}.`:'Invitation found.');
  button.disabled=true;
  $('#gate').classList.add('gate-out');
  const wait=matchMedia('(prefers-reduced-motion: reduce)').matches?0:600;
  setTimeout(()=>{location.href='/site'},wait);
}

let checking=false;
async function submitCode(){
  if(checking)return;
  const code=input.value.trim().toUpperCase();
  if(!code){fail('missing_code');return}
  checking=true;button.disabled=true;setMessage(MESSAGES.checking);
  let res,data;
  try{
    res=await fetch('/api/code',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})});
    data=await res.json().catch(()=>({}));
  }catch(e){checking=false;fail('network');return}
  checking=false;
  if(res.ok&&data.ok){enterSite(typeof data.issuedTo==='string'?data.issuedTo.trim():'');return}
  if(res.status>=500){fail('network');return}
  fail(data.reason);
}

form.addEventListener('submit',e=>{e.preventDefault();submitCode()});

// Personal links: /?invite=CODE (alias /?code=CODE) prefill the field, show the recognized state
// and submit on load. Any ?guest= value is ignored; the name comes from the API.
const params=new URLSearchParams(location.search);
const linked=(params.get('invite')||params.get('code')||'').trim().toUpperCase();
if(linked){
  input.value=linked;
  card.classList.add('recognized-invite');
  intro.textContent='Katie invited you to The Spanish Offseason. Your private invitation link is recognized — no code needed.';
  button.textContent='Enter The Spanish Offseason';
  submitCode();
}else{
  setMessage(MESSAGES.idle);
}
