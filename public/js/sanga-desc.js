/* Shows an event description on the event pages. The description is saved as one text with the headings
   "Details", "Plan" and "What to bring" (see create_event.html). Each heading is shown bold and black; what to bring
   is shown as a row of small rounded boxes. Text without those headings is shown as plain text. */
(function(){
  var HEADINGS = { 'details': 'Details', 'plan': 'Plan', 'what to bring': 'What to bring', 'what to expect': 'What to bring' };

  function headingOf(line){
    var t = String(line).trim().replace(/[:*#\s]+$/, '').replace(/^[*#\s]+/, '').toLowerCase();
    return HEADINGS[t] || null;
  }
  function el(tag, cls, text){
    var n = document.createElement(tag);
    if(cls) n.className = cls;
    if(text != null) n.textContent = text;
    return n;
  }

  function render(target, text){
    target.textContent = '';
    target.style.whiteSpace = 'normal';
    var sections = [], cur = null;
    String(text || '').split('\n').forEach(function(line){
      var h = headingOf(line);
      if(h){ cur = { title: h, lines: [] }; sections.push(cur); return; }
      if(!cur){ cur = { title: '', lines: [] }; sections.push(cur); }
      cur.lines.push(line);
    });
    sections.forEach(function(sec){
      var body = sec.lines.join('\n').trim();
      if(!body && !sec.title) return;
      var box = el('div', 'desc-sec');
      if(sec.title) box.appendChild(el('div', 'desc-sec-title', sec.title));
      if(sec.title === 'What to bring'){
        var row = el('div', 'bring-row');
        body.split(/[\n,;]/).map(function(l){ return l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim(); }).filter(Boolean)
          .forEach(function(item){ row.appendChild(el('span', 'bring-chip', item)); });
        box.appendChild(row);
      } else if(body){
        box.appendChild(el('div', 'desc-sec-body', body));
      }
      target.appendChild(box);
    });
  }

  var css = '.desc-text{opacity:1}.desc-sec{margin-bottom:14px}.desc-sec:last-child{margin-bottom:0}' +
    '.desc-sec-title{font-family:Poppins,sans-serif;font-weight:700;color:#000;font-size:15.5px;margin:0 0 6px}' +
    '.desc-sec-body{white-space:pre-line;opacity:.85}' +
    '.bring-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}' +
    '.bring-chip{background:#F2A94E;color:#000;border-radius:10px;padding:7px 14px;font-size:13px;font-weight:700}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // Same thing as an HTML string, for pages that build their markup from templates.
  function html(text){ var d = document.createElement('div'); render(d, text); return d.innerHTML; }

  window.SanghaDesc = { render: render, html: html };
})();
