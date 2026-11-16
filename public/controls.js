// Progressive enhancement: the original form controls remain the source of truth.
let installed = false;
let serial = 0;
let openMenu = null;
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const format = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number(value));
const labelFor = input => input.getAttribute('aria-label') || input.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || input.name || 'Value';
const emit = input => { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };

function closeMenu(returnFocus = false) {
  if (!openMenu) return;
  const { menu, trigger } = openMenu;
  if (menu.matches(':popover-open')) menu.hidePopover();
  menu.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
  if (returnFocus && trigger.isConnected) trigger.focus();
  openMenu = null;
}

function updateSelect(select) {
  const segments=select.closest('.segment-control');
  if(segments){segments.querySelectorAll('[data-choice-index]').forEach(button=>{const option=select.options[Number(button.dataset.choiceIndex)];button.disabled=select.disabled||option.disabled;button.setAttribute('aria-pressed',String(option.selected));});return;}
  const wrapper = select.closest('.choice-control');
  if (!wrapper) return;
  const trigger = wrapper.querySelector('.choice-trigger');
  const selected = select.options[select.selectedIndex];
  trigger.querySelector('.choice-value').textContent = selected?.textContent || 'Choose';
  trigger.disabled = select.disabled;
  trigger.setAttribute('aria-label', `${select.dataset.controlLabel}: ${selected?.textContent || 'Choose'}`);
  wrapper.querySelectorAll('[role="option"]').forEach(option => {
    option.setAttribute('aria-selected', String(Number(option.dataset.index) === select.selectedIndex));
  });
}

function enhanceSelect(select) {
  if (select.multiple || select.size > 1 || select.dataset.native === 'true') return;
  if(select.closest('.segment-control')){updateSelect(select);return;}
  if(['capacity','pace','bots'].includes(select.name)||select.id==='host-bot-difficulty'){
    const wrapper=document.createElement('span');wrapper.className='segment-control';wrapper.setAttribute('role','group');wrapper.setAttribute('aria-label',labelFor(select));select.before(wrapper);wrapper.append(select);select.classList.add('control-native');select.tabIndex=-1;
    [...select.options].forEach((option,index)=>{const button=document.createElement('button');button.type='button';button.dataset.choiceIndex=index;button.textContent=option.textContent;button.addEventListener('click',event=>{event.preventDefault();select.selectedIndex=index;updateSelect(select);emit(select);});wrapper.append(button);});select.addEventListener('change',()=>updateSelect(select));updateSelect(select);return;
  }
  if (select.closest('.choice-control')) { updateSelect(select); return; }
  select.dataset.controlLabel = labelFor(select);
  const wrapper = document.createElement('span'); wrapper.className = 'choice-control';
  select.before(wrapper); wrapper.append(select);
  select.classList.add('control-native'); select.tabIndex = -1;
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.className = 'choice-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
  const value = document.createElement('span'); value.className = 'choice-value';
  const arrow = document.createElement('span'); arrow.className = 'choice-arrow'; arrow.setAttribute('aria-hidden','true'); arrow.textContent = '⌄';
  trigger.append(value, arrow);
  const menu = document.createElement('div'); menu.className = 'choice-menu'; menu.id = `choice-menu-${++serial}`;
  menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', select.dataset.controlLabel); menu.setAttribute('popover','manual'); menu.hidden = true;
  trigger.setAttribute('aria-controls', menu.id);
  wrapper.append(trigger, menu);
  const populate = () => {
    menu.replaceChildren();
    [...select.options].forEach((option, index) => {
      const item = document.createElement('button'); item.type = 'button'; item.className = 'choice-option';
      item.setAttribute('role','option'); item.setAttribute('aria-selected', String(index === select.selectedIndex));
      item.dataset.index = index; item.textContent = option.textContent; item.disabled = option.disabled;
      item.addEventListener('click', event => { event.preventDefault(); select.selectedIndex = index; closeMenu(true); updateSelect(select); emit(select); });
      menu.append(item);
    });
  };
  const show = () => {
    if (openMenu?.trigger === trigger) { closeMenu(true); return; }
    closeMenu(); populate(); menu.hidden = false;
    if (menu.showPopover) menu.showPopover();
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 190), window.innerWidth - 24);
    menu.style.width = `${width}px`; menu.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
    const available = Math.max(100, window.innerHeight - rect.bottom - 20);
    menu.style.maxHeight = `${Math.min(340, available < 150 ? Math.max(100,rect.top - 20) : available)}px`;
    menu.style.top = available < 150 ? 'auto' : `${rect.bottom + 8}px`;
    menu.style.bottom = available < 150 ? `${window.innerHeight - rect.top + 8}px` : 'auto';
    trigger.setAttribute('aria-expanded','true'); openMenu = { menu, trigger };
    (menu.querySelector('[aria-selected="true"]:not(:disabled)') || menu.querySelector('button:not(:disabled)'))?.focus();
  };
  trigger.addEventListener('click', event => { event.preventDefault(); show(); });
  trigger.addEventListener('keydown', event => { if (['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); show(); } });
  menu.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const current = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    else if (event.key === 'Tab') closeMenu();
    else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index]?.focus();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const next = [...items.slice(current + 1), ...items.slice(0,current + 1)].find(item => item.textContent.toLowerCase().startsWith(event.key.toLowerCase()));
      next?.focus();
    }
  });
  select.addEventListener('change', () => updateSelect(select));
  select.addEventListener('invalid', () => trigger.focus());
  updateSelect(select);
}

function refreshNumber(input) {
  const wrapper = input.closest('.number-control'); if (!wrapper) return;
  wrapper.querySelector('[data-step="-1"]').disabled = input.disabled || (input.min !== '' && number(input.value) <= number(input.min));
  wrapper.querySelector('[data-step="1"]').disabled = input.disabled || (input.max !== '' && number(input.value) >= number(input.max));
}

function enhanceNumber(input) {
  if (input.readOnly || input.dataset.native === 'true') return;
  if (input.closest('.number-control')) { refreshNumber(input); return; }
  const title = labelFor(input);
  const wrapper = document.createElement('span'); wrapper.className = 'number-control';
  input.before(wrapper); wrapper.append(input);
  for (const delta of [-1, 1]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'step-control'; button.dataset.step = delta;
    button.textContent = delta === -1 ? '−' : '+'; button.setAttribute('aria-label',`${delta === -1 ? 'Decrease' : 'Increase'} ${title}`);
    if (delta === -1) wrapper.prepend(button); else wrapper.append(button);
    button.addEventListener('click', event => {
      event.preventDefault();
      try { delta === -1 ? input.stepDown() : input.stepUp(); }
      catch { input.value = number(input.value) + delta; }
      refreshNumber(input); emit(input);
    });
  }
  input.addEventListener('input', () => refreshNumber(input));
  refreshNumber(input);
}

function updateRange(input) {
  const wrapper = input.closest('.range-control'); if (!wrapper) return;
  const min = input.min === '' ? 0 : number(input.min), max = input.max === '' ? 100 : number(input.max), value = number(input.value);
  input.style.setProperty('--range-fill', `${max > min ? Math.max(0, Math.min(100, (value-min)/(max-min)*100)) : 0}%`);
  const percent = max <= 1 && min === 0;
  wrapper.querySelector('.range-value').textContent = percent ? `${Math.round(value * 100)}%` : format(value);
  wrapper.querySelector('.range-min').textContent = percent ? '0%' : format(min);
  wrapper.querySelector('.range-max').textContent = percent ? '100%' : format(max);
  wrapper.classList.toggle('is-disabled', input.disabled);
}

function enhanceRange(input) {
  if (input.closest('.range-control')) { updateRange(input); return; }
  const wrapper = document.createElement('span'); wrapper.className = 'range-control';
  input.before(wrapper); wrapper.append(input);
  const readout = document.createElement('output'); readout.className = 'range-value';
  if (!input.id) input.id = `range-${++serial}`;
  readout.htmlFor = input.id; readout.setAttribute('aria-hidden','true');
  const min = document.createElement('span'); min.className = 'range-min'; min.setAttribute('aria-hidden','true');
  const max = document.createElement('span'); max.className = 'range-max'; max.setAttribute('aria-hidden','true');
  wrapper.append(min,readout,max);
  input.addEventListener('input', () => updateRange(input));
  input.addEventListener('change', () => updateRange(input));
  updateRange(input);
}

export function enhanceControls(root = document) {
  root.querySelectorAll('select').forEach(enhanceSelect);
  root.querySelectorAll('input[type="number"]').forEach(enhanceNumber);
  root.querySelectorAll('input[type="range"]').forEach(enhanceRange);
  if (openMenu && !openMenu.trigger.isConnected) closeMenu();
}

export function installControls({ sound } = {}) {
  if (installed) return; installed = true;
  let queued = false;
  const observer = new MutationObserver(records => {
    if (queued || !records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches?.('select,input,main,form,dialog') || node.querySelector?.('select,input'))))) return;
    queued = true; queueMicrotask(() => { queued = false; enhanceControls(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('input', event => {
    const input = event.target;
    // A paired numeric field may update a slider without dispatching a second event.
    if (input.matches('input[type="number"],input[type="range"]')) queueMicrotask(() => {
      document.querySelectorAll('input[type="range"]').forEach(updateRange);
      document.querySelectorAll('input[type="number"]').forEach(refreshNumber);
    });
  });
  document.addEventListener('change',event=>{if(event.target.matches('select'))queueMicrotask(()=>document.querySelectorAll('select').forEach(updateSelect));});
  document.addEventListener('pointerdown', event => {
    if (openMenu && !openMenu.menu.contains(event.target) && !openMenu.trigger.contains(event.target)) closeMenu();
    const button = event.target.closest('button:not(:disabled):not(.playing-card)');
    if (!button) return;
    button.classList.remove('control-hit'); void button.offsetWidth; button.classList.add('control-hit');
    setTimeout(() => button.classList.remove('control-hit'), 220);
    button.addEventListener('animationend', () => button.classList.remove('control-hit'), { once:true });
    sound?.('tap');
  });
  window.addEventListener('resize', () => closeMenu());
  window.addEventListener('scroll', event => { if (openMenu && !openMenu.menu.contains(event.target)) closeMenu(); }, true);
  enhanceControls();
}
