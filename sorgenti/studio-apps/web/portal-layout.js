(function () {
  'use strict';
  const KEY = 'studio-example.portal-layout.v1';
  function normalize(saved, groups, apps) {
    const order = [...new Set((Array.isArray(saved?.order) ? saved.order : []).filter(g => groups.includes(g)))];
    groups.forEach(g => { if (!order.includes(g)) order.push(g); });
    const assignments = {};
    apps.forEach(a => { assignments[a.title] = groups.includes(saved?.assignments?.[a.title]) ? saved.assignments[a.title] : a.group; });
    return {order, assignments};
  }
  function moveGroup(state, group, target, after = false) {
    if (group === target || !state.order.includes(group) || !state.order.includes(target)) return;
    state.order = state.order.filter(g => g !== group);
    state.order.splice(state.order.indexOf(target) + Number(after), 0, group);
  }
  window.PortalLayout = {normalize, moveGroup, init};
  function init(refresh) {
    const defaults = [...window.APP_GROUPS];
    const apps = window.APPS.map(a => ({...a}));
    let saved;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (_) { saved = null; }
    let state = normalize(saved, defaults, apps);
    const style = document.createElement('style');
    style.textContent = `.layout-dialog{margin:auto;box-sizing:border-box;width:min(760px,94vw);max-height:90vh;border:1px solid #ccd9e5;border-radius:16px;padding:22px;color:#172033;background:white;font:14px "Segoe UI",sans-serif}.layout-dialog::backdrop{background:#10243b99}.layout-dialog h2{margin:0 0 8px}.layout-dialog button,.layout-dialog select,.layout-open{font:inherit;padding:8px;border:1px solid #a9bdce;border-radius:6px;background:white;color:#173950;cursor:pointer}.layout-dialog button:disabled{opacity:.4;cursor:default}.layout-dialog p{line-height:1.5}.layout-group{border:1px solid #ccd9e5;border-radius:10px;margin:12px 0;padding:10px}.layout-group header{display:flex;align-items:center;gap:8px;background:transparent;color:inherit;padding:0;flex-wrap:wrap}.layout-group header strong{flex:1}.layout-item{display:flex;align-items:center;gap:8px;padding:8px 0;flex-wrap:wrap}.layout-item span{flex:1;min-width:130px}.layout-item select{max-width:100%}.layout-grip{cursor:grab!important;touch-action:auto}.layout-drop{outline:3px solid #0082c9;background:#edf8ff}.layout-open{display:block;margin:10px 0;width:100%;font-size:14px}.layout-actions{display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap}.layout-dialog :focus-visible{outline:3px solid #0082c9;outline-offset:2px}`;
    document.head.appendChild(style);
    const dialog = document.createElement('dialog');
    dialog.className = 'layout-dialog';
    dialog.setAttribute('aria-labelledby', 'layout-title');
    const heading = document.createElement('h2'); heading.id = 'layout-title'; heading.textContent = 'Organizza le app';
    const help = document.createElement('p'); help.textContent = 'Trascina ⋮⋮ per riordinare le macroclassi o spostare un’app in un altro gruppo. In alternativa usa le frecce e il menu della macroclasse. Le modifiche si salvano in questo browser, anche nella versione mobile; non si sincronizzano con altri dispositivi.';
    const live = document.createElement('p'); live.setAttribute('role','status');
    const list = document.createElement('div');
    const actions = document.createElement('div'); actions.className = 'layout-actions';
    const reset = button('Ripristina disposizione iniziale', () => {state = normalize(null,defaults,apps); commit('Disposizione iniziale ripristinata.'); render();});
    const close = button('Fine', () => dialog.close());
    actions.append(reset,close); dialog.append(heading,help,live,list,actions); document.body.appendChild(dialog);
    const open = button('↕ Organizza app', () => {render(); dialog.showModal();}); open.className = 'layout-open';
    const host = document.getElementById('apps-list') || document.getElementById('grouped-apps');
    host.before(open);
    let dragging = null;
    function apply() {
      window.APP_GROUPS = [...state.order];
      window.APPS = apps.map(a => ({...a,group:state.assignments[a.title]}));
      refresh();
    }
    function commit(message) {
      try { localStorage.setItem(KEY,JSON.stringify(state)); live.textContent = message + ' Salvato in questo browser.'; }
      catch (_) { live.textContent = message + ' Salvataggio non disponibile: la modifica durerà fino alla chiusura della pagina.'; }
      apply();
    }
    function button(label, action) {const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);return b;}
    function grip(label, value) {
      const b=button('⋮⋮',()=>{});b.className='layout-grip';b.title=label;b.setAttribute('aria-label',label);b.draggable=false;
      b.style.touchAction='none';
      b.addEventListener('pointerdown', e => {
        if(e.button!==0)return;
        const startX=e.clientX,startY=e.clientY;let moved=false,lastY=e.clientY,frame;
        b.setPointerCapture(e.pointerId);
        const scroll=()=>{if(moved){const r=dialog.getBoundingClientRect();if(lastY<r.top+45)dialog.scrollTop-=12;else if(lastY>r.bottom-45)dialog.scrollTop+=12;}frame=requestAnimationFrame(scroll);};
        const move=ev=>{lastY=ev.clientY;if(Math.hypot(ev.clientX-startX,ev.clientY-startY)<6&&!moved)return;moved=true;ev.preventDefault();list.querySelectorAll('.layout-drop').forEach(n=>n.classList.remove('layout-drop'));const target=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('.layout-group');if(target)target.classList.add('layout-drop');};
        const end=ev=>{cancelAnimationFrame(frame);b.removeEventListener('pointermove',move);b.removeEventListener('pointerup',end);b.removeEventListener('pointercancel',end);list.querySelectorAll('.layout-drop').forEach(n=>n.classList.remove('layout-drop'));if(!moved||ev.type==='pointercancel')return;const target=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('.layout-group');if(!target)return;const group=target.getAttribute('aria-label');if(value.kind==='group'){const r=target.getBoundingClientRect();moveGroup(state,value.id,group,ev.clientY>r.top+r.height/2);}else state.assignments[value.id]=group;commit('Disposizione aggiornata.');render();};
        b.addEventListener('pointermove',move);b.addEventListener('pointerup',end);b.addEventListener('pointercancel',end);frame=requestAnimationFrame(scroll);
      });
      b.addEventListener('dragstart', e => {dragging=value;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',JSON.stringify(value));e.stopPropagation();});
      b.addEventListener('dragend',()=>{dragging=null;list.querySelectorAll('.layout-drop').forEach(n=>n.classList.remove('layout-drop'));});
      return b;
    }
    function render(focusLabel) {
      list.replaceChildren();
      state.order.forEach((group,index)=>{
        const section=document.createElement('section');section.className='layout-group';section.setAttribute('aria-label',group);
        const header=document.createElement('header');
        const title=document.createElement('strong');title.textContent=group;
        const up=button('↑',()=>{moveGroup(state,group,state.order[index-1]);commit(group+' spostata in alto.');render('Sposta in alto '+group);});
        up.setAttribute('aria-label','Sposta in alto '+group);up.disabled=index===0;
        const down=button('↓',()=>{moveGroup(state,group,state.order[index+1],true);commit(group+' spostata in basso.');render('Sposta in basso '+group);});
        down.setAttribute('aria-label','Sposta in basso '+group);down.disabled=index===state.order.length-1;
        header.append(grip('Trascina macroclasse '+group,{kind:'group',id:group}),title,up,down);section.appendChild(header);
        const items=apps.filter(a=>state.assignments[a.title]===group);
        if(!items.length){const empty=document.createElement('p');empty.textContent='Gruppo vuoto: trascina qui un’app.';section.appendChild(empty);}
        items.forEach(app=>{
          const row=document.createElement('div');row.className='layout-item';
          const text=document.createElement('span');text.textContent=app.title;
          const select=document.createElement('select');select.setAttribute('aria-label','Macroclasse di '+app.title);
          state.order.forEach(g=>{const o=document.createElement('option');o.value=g;o.textContent=g;select.appendChild(o);});select.value=group;
          select.addEventListener('change',()=>{state.assignments[app.title]=select.value;commit(app.title+' spostata in '+select.value+'.');render('Macroclasse di '+app.title);});
          row.append(grip('Trascina app '+app.title,{kind:'app',id:app.title}),text,select);section.appendChild(row);
        });
        section.addEventListener('dragover',e=>{if(!dragging)return;e.preventDefault();e.dataTransfer.dropEffect='move';section.classList.add('layout-drop');});
        section.addEventListener('dragleave',e=>{if(!section.contains(e.relatedTarget))section.classList.remove('layout-drop');});
        section.addEventListener('drop',e=>{
          if(!dragging)return;e.preventDefault();e.stopPropagation();const item=dragging;dragging=null;
          if(item.kind==='group'){const r=section.getBoundingClientRect();moveGroup(state,item.id,group,e.clientY>r.top+r.height/2);}
          else if(Object.hasOwn(state.assignments,item.id))state.assignments[item.id]=group;
          commit('Disposizione aggiornata.');render();
        });
        list.appendChild(section);
      });
      if(focusLabel){const target=[...list.querySelectorAll('[aria-label]')].find(n=>n.getAttribute('aria-label')===focusLabel);if(target&&!target.disabled)target.focus();}
    }
    apply();
  }
})();
