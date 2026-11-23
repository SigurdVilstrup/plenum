/** Plenum-styled select: progressive enhance of native <select>. Keeps .value / change / form names. */

const CARET = '<svg class="icon sm" aria-hidden="true"><use href="#i-caret-down"></use></svg>';

let openWrap = null;
let dismissBound = null;
let keyBound = null;

/** Visible label for the current value (empty option → its text, or placeholder). */
export function selectLabel(select) {
  const opt = select.selectedOptions?.[0] || select.options?.[select.selectedIndex];
  if (!opt) return '';
  return (opt.textContent || '').trim();
}

export function closeSelectMenus() {
  document.querySelectorAll('.pl-select-menu').forEach((m) => m.remove());
  if (openWrap) {
    openWrap.classList.remove('open');
    openWrap.querySelector('.pl-select-trigger')?.setAttribute('aria-expanded', 'false');
    openWrap = null;
  }
  if (dismissBound) {
    document.removeEventListener('mousedown', dismissBound, true);
    dismissBound = null;
  }
  if (keyBound) {
    document.removeEventListener('keydown', keyBound, true);
    keyBound = null;
  }
}

function syncTrigger(wrap, select) {
  const valueEl = wrap.querySelector('.pl-select-value');
  if (valueEl) valueEl.textContent = selectLabel(select) || '\u00a0';
  wrap.classList.toggle('is-disabled', select.disabled);
  wrap.classList.toggle('is-empty', !select.value);
  const trigger = wrap.querySelector('.pl-select-trigger');
  if (trigger) trigger.disabled = select.disabled;
}

/** Position a fixed menu so it stays inside the viewport (right/bottom edges first). */
export function placeMenu(menu, trigger, {
  pad = 8,
  maxW = 360,
  maxH = 280,
  viewW = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewH = typeof window !== 'undefined' ? window.innerHeight : 800,
} = {}) {
  const r = trigger.getBoundingClientRect();
  const availW = Math.max(120, viewW - pad * 2);
  menu.style.minWidth = `${Math.min(Math.max(r.width, 160), availW)}px`;
  menu.style.maxWidth = `${Math.min(maxW, availW)}px`;
  // Park at origin so offsetWidth/Height reflect content under the max-width cap.
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.style.maxHeight = `${Math.min(maxH, viewH - pad * 2)}px`;
  const mw = menu.offsetWidth || Math.max(r.width, 160);
  const mh = menu.offsetHeight || 40;

  let left = r.left;
  if (left + mw > viewW - pad) left = viewW - pad - mw;
  if (left < pad) left = pad;

  let top = r.bottom + 4;
  if (top + mh > viewH - pad) top = Math.max(pad, r.top - mh - 4);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.maxHeight = `${Math.min(maxH, viewH - top - pad)}px`;
}

function openMenu(wrap, select, trigger) {
  closeSelectMenus();
  if (select.disabled) return;

  const menu = document.createElement('div');
  menu.className = 'pl-select-menu';
  menu.setAttribute('role', 'listbox');
  if (select.getAttribute('aria-label')) {
    menu.setAttribute('aria-label', select.getAttribute('aria-label'));
  }

  const options = [...select.options];
  let active = Math.max(0, select.selectedIndex);

  const paintActive = () => {
    menu.querySelectorAll('.pl-select-option').forEach((btn, i) => {
      btn.classList.toggle('is-active', i === active);
      if (i === active) btn.scrollIntoView({ block: 'nearest' });
    });
  };

  options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pl-select-option';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', opt.selected ? 'true' : 'false');
    if (opt.disabled) btn.disabled = true;
    if (select.classList.contains('mono') || opt.classList.contains('mono')) btn.classList.add('mono');
    btn.innerHTML = `<span class="pl-select-check" aria-hidden="true">${opt.selected ? '✓' : ''}</span><span class="pl-select-option-label"></span>`;
    btn.querySelector('.pl-select-option-label').textContent = (opt.textContent || '').trim();
    btn.addEventListener('mouseenter', () => { active = i; paintActive(); });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (opt.disabled) return;
      const prev = select.value;
      select.selectedIndex = i;
      syncTrigger(wrap, select);
      closeSelectMenus();
      if (select.value !== prev) select.dispatchEvent(new Event('change', { bubbles: true }));
      trigger.focus();
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  placeMenu(menu, trigger);
  wrap.classList.add('open');
  trigger.setAttribute('aria-expanded', 'true');
  openWrap = wrap;
  paintActive();

  dismissBound = (ev) => {
    if (menu.contains(ev.target) || wrap.contains(ev.target)) return;
    closeSelectMenus();
  };
  keyBound = (ev) => {
    if (!openWrap) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeSelectMenus();
      trigger.focus();
      return;
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      active = Math.min(options.length - 1, active + 1);
      while (active < options.length - 1 && options[active].disabled) active += 1;
      paintActive();
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      active = Math.max(0, active - 1);
      while (active > 0 && options[active].disabled) active -= 1;
      paintActive();
      return;
    }
    if (ev.key === 'Home') {
      ev.preventDefault();
      active = 0;
      paintActive();
      return;
    }
    if (ev.key === 'End') {
      ev.preventDefault();
      active = options.length - 1;
      paintActive();
      return;
    }
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      menu.querySelectorAll('.pl-select-option')[active]?.click();
    }
  };
  setTimeout(() => {
    document.addEventListener('mousedown', dismissBound, true);
    document.addEventListener('keydown', keyBound, true);
  }, 0);
}

function enhanceSelect(select) {
  if (select.dataset.plEnhanced === '1') return;
  // Already wrapped (e.g. re-query after enhance)
  if (select.closest('.pl-select')) {
    select.dataset.plEnhanced = '1';
    return;
  }
  select.dataset.plEnhanced = '1';

  const wrap = document.createElement('div');
  wrap.className = 'pl-select';
  if (select.classList.contains('mono')) wrap.classList.add('mono');
  if (select.classList.contains('branch-vs')) wrap.classList.add('is-ghost');
  if (select.classList.contains('select')) wrap.classList.add('is-select');
  if (select.classList.contains('input')) wrap.classList.add('is-input');
  if (select.disabled) wrap.classList.add('is-disabled');
  if (!select.value) wrap.classList.add('is-empty');

  select.parentNode.insertBefore(wrap, select);
  select.classList.add('pl-select-native');
  wrap.appendChild(select);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'pl-select-trigger';
  trigger.disabled = select.disabled;
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const aria = select.getAttribute('aria-label');
  if (aria) trigger.setAttribute('aria-label', aria);
  if (select.id) trigger.id = `${select.id}-trigger`;

  const valueEl = document.createElement('span');
  valueEl.className = 'pl-select-value';
  valueEl.textContent = selectLabel(select) || '\u00a0';

  trigger.innerHTML = CARET;
  trigger.insertBefore(valueEl, trigger.firstChild);
  wrap.insertBefore(trigger, select);

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (select.disabled) return;
    if (wrap.classList.contains('open')) closeSelectMenus();
    else openMenu(wrap, select, trigger);
  });

  trigger.addEventListener('keydown', (e) => {
    if (select.disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      if (wrap.classList.contains('open')) return;
      e.preventDefault();
      openMenu(wrap, select, trigger);
    }
  });

  select.addEventListener('change', () => syncTrigger(wrap, select));
}

/** Enhance every native select under root (idempotent). */
export function enhanceSelects(root = document) {
  if (!root) return;
  root.querySelectorAll('select').forEach(enhanceSelect);
}
