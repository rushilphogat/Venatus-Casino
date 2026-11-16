export const avatarNames=['Fox','Midnight cat','Frog','Capybara','Owl','Ghost','Red panda','Robot','Rabbit','Bear','Dragon','Axolotl','Raccoon','Seal','Mushroom','Penguin','Bat','Otter','Shiba','Turtle','Tiger','Cardinal','Alien','Cloud'];
export const emotes=['♥','✦','?!','GG','☕','👀','👏','😂','💀','🔥','✨','🤝'];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function portrait(player={},extra='') {
  let id=player.avatar?.id;
  if(!Number.isInteger(id)||id<0||id>23)id=[...String(player.id||player.name||'Venatus')].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,0)%24;
  const avatar=player.avatar, label=escape(player.name||player.displayName||avatarNames[id]);
  const url=avatar?.kind==='upload'&&/^\/api\/avatars\/[a-zA-Z0-9_-]+\?v=[a-zA-Z0-9_-]+$/.test(avatar.url||'')?avatar.url:null;
  return `<span class="portrait ${extra}" role="img" aria-label="${label}" style="--portrait-x:${(id%6)*20}%;--portrait-y:${Math.floor(id/6)*100/3}%">${url?`<img src="${escape(url)}" alt="" loading="lazy">`:''}</span>`;
}

export function installProfiles({api,openModal,toast,getUser,onSaved}) {
  let selected=0, upload=null, bitmap=null, zoom=1, x=.5, y=.5, drag=null;
  const draw=()=>{
    const canvas=document.getElementById('avatar-crop');if(!canvas||!bitmap)return;
    const ctx=canvas.getContext('2d'),size=Math.min(bitmap.width,bitmap.height)/zoom;
    const sx=(bitmap.width-size)*x,sy=(bitmap.height-size)*y;
    ctx.clearRect(0,0,256,256);ctx.drawImage(bitmap,sx,sy,size,size,0,0,256,256);
    upload=canvas.toDataURL('image/webp',.86);
  };
  const select=id=>{
    selected=id;upload=null;bitmap?.close?.();bitmap=null;
    document.querySelectorAll('[data-avatar-preset]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.avatarPreset)===id)));
    const preview=document.querySelector('.profile-preview');if(preview)preview.innerHTML=portrait({avatar:{kind:'preset',id},name:avatarNames[id]});
    const crop=document.querySelector('.crop-tools');if(crop)crop.hidden=true;
  };
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-profile],[data-avatar-preset],[data-avatar-random]');if(!button)return;
    try {
      if(button.hasAttribute('data-profile')) {
        const {profile}=await api('/api/profile');selected=profile.avatar?.kind==='upload'?null:profile.avatar?.id??0;upload=null;bitmap?.close?.();bitmap=null;
        openModal('Your player',`<form id="profile-form" class="stack"><div class="profile-preview">${portrait({...profile,name:profile.displayName})}</div><label>Display name<input name="displayName" autocomplete="nickname" maxlength="24" value="${escape(profile.displayName||getUser()?.name)}" required></label><div class="profile-picker" role="group" aria-label="Choose an avatar">${avatarNames.map((name,id)=>`<button type="button" data-avatar-preset="${id}" aria-label="${name}" aria-pressed="${profile.avatar?.kind!=='upload'&&id===selected}">${portrait({avatar:{kind:'preset',id},name})}</button>`).join('')}</div><div class="profile-options"><button type="button" data-avatar-random>Surprise me</button><label class="upload-button">Upload a picture<input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp"></label></div><div class="crop-tools" hidden><canvas id="avatar-crop" width="256" height="256" aria-label="Drag to position your picture"></canvas><label>Zoom<input id="avatar-zoom" type="range" min="1" max="4" step=".05" value="1"></label><small>Drag the picture to frame it.</small></div><p class="form-error" role="alert"></p><button class="primary" type="submit">Save player</button></form>`);
      } else select(button.hasAttribute('data-avatar-random')?crypto.getRandomValues(new Uint32Array(1))[0]%24:Number(button.dataset.avatarPreset));
    } catch(error){toast(error.message);}
  });
  document.addEventListener('change',async event=>{
    if(event.target.id!=='avatar-file')return;
    const file=event.target.files[0];if(!file)return;
    try {
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Choose a JPG, PNG or WebP picture under 5 MB.');
      bitmap?.close?.();bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>40e6){bitmap.close();bitmap=null;throw new Error('Choose a smaller picture.');}
      zoom=1;x=y=.5;document.querySelector('.crop-tools').hidden=false;document.querySelector('#avatar-zoom').value=1;
      document.querySelectorAll('[data-avatar-preset]').forEach(b=>b.setAttribute('aria-pressed','false'));draw();
    }catch(error){toast(error.message);}
  });
  document.addEventListener('input',event=>{if(event.target.id==='avatar-zoom'){zoom=Number(event.target.value);draw();}});
  document.addEventListener('pointerdown',event=>{if(event.target.id==='avatar-crop'&&bitmap){drag={x:event.clientX,y:event.clientY,px:x,py:y};event.target.setPointerCapture(event.pointerId);}});
  document.addEventListener('pointermove',event=>{if(!drag||!bitmap)return;const size=event.target.getBoundingClientRect().width||256;x=Math.max(0,Math.min(1,drag.px-(event.clientX-drag.x)/size));y=Math.max(0,Math.min(1,drag.py-(event.clientY-drag.y)/size));draw();});
  document.addEventListener('pointerup',()=>drag=null);
  document.addEventListener('pointercancel',()=>drag=null);
  document.addEventListener('submit',async event=>{
    if(event.target.id!=='profile-form')return;event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;
    try {
      const body={displayName:form.elements.displayName.value,...(upload?{image:upload}:selected!==null?{preset:selected}:{})};
      const result=await api('/api/profile',body);await onSaved(result.profile);document.querySelector('#modal').close();toast('Player saved.');
    }catch(error){form.querySelector('.form-error').textContent=error.message;}finally{button.disabled=false;}
  });
}
