// Invitation gate (index.html). The site itself lives on /site (site.html, js/site.js).
const $=s=>document.querySelector(s);
const form=$('#inviteForm'),input=$('#inviteCode'),button=$('#enterButton');

function enterSite(){
  button.disabled=true;
  $('#gate').classList.add('gate-out');
  const wait=matchMedia('(prefers-reduced-motion: reduce)').matches?0:600;
  setTimeout(()=>{location.href='/site'},wait);
}

// WAVE 3: replace with POST /api/code (states on #inviteMessage, disable #enterButton while
// checking, auto-submit when the code came from the link). Until then: trim, uppercase, accept any code of 4+ characters.
form.addEventListener('submit',e=>{
  e.preventDefault();
  const code=input.value.trim().toUpperCase();
  if(code.length>=4)enterSite();else input.focus();
});

// Personal links: /?invite=CODE (alias /?code=CODE) prefill the field and show the recognized state.
const params=new URLSearchParams(location.search);
const linked=(params.get('invite')||params.get('code')||'').trim().toUpperCase();
if(linked){
  input.value=linked;
  $('.invite-card').classList.add('recognized-invite');
  $('#inviteIntro').textContent='Katie invited you to The Spanish Offseason. Your private invitation link is recognized — no code needed.';
  button.textContent='Enter The Spanish Offseason';
}
