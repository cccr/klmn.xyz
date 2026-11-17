// Tiny element builders. Text always goes in through textContent / setAttribute, never innerHTML.
(function (PCB) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function build(el, attrs, kids) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'value' && 'value' in el) el.value = v;
      else if (k === 'checked' && 'checked' in el) el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    const add = (kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      if (Array.isArray(kid)) kid.forEach(add);
      else el.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
    };
    kids.forEach(add);
    return el;
  }

  PCB.h = (tag, attrs, ...kids) => build(document.createElement(tag), attrs, kids);
  PCB.s = (tag, attrs, ...kids) => build(document.createElementNS(SVG_NS, tag), attrs, kids);
  PCB.SVG_NS = SVG_NS;
  PCB.clear = (el) => {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };
})(globalThis.PCB = globalThis.PCB || {});
