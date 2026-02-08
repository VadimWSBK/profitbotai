/**
 * Utilities module - DOM helpers, SVG creation, throttling, etc.
 */
export const utils = String.raw`
  /* ===== 2. UTILITIES ===== */
  var prefersReducedMotion = false;
  try {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = mq.matches;
    mq.addEventListener('change', function(e) { prefersReducedMotion = e.matches; });
  } catch (e) {}

  function dur(ms) { return prefersReducedMotion ? 0 : ms; }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        if (!attrs.hasOwnProperty(key)) continue;
        var val = attrs[key];
        if (key === 'style' && typeof val === 'object') {
          for (var sk in val) { if (val.hasOwnProperty(sk)) node.style[sk] = val[sk]; }
        } else if (key === 'className') {
          node.className = val;
        } else if (key.indexOf('on') === 0 && typeof val === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (key === 'innerHTML') {
          node.innerHTML = val;
        } else if (key === 'textContent') {
          node.textContent = val;
        } else {
          node.setAttribute(key, val);
        }
      }
    }
    if (children) {
      var arr = Array.isArray(children) ? children : [children];
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        if (typeof c === 'string') node.appendChild(document.createTextNode(c));
        else if (c) node.appendChild(c);
      }
    }
    return node;
  }

  function svgEl(viewBox, pathD, size, color) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('width', size || '16');
    svg.setAttribute('height', size || '16');
    svg.style.fill = 'none';
    svg.style.stroke = color || 'currentColor';
    svg.style.pointerEvents = 'none';
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);
    return svg;
  }

  function svgFilled(viewBox, pathD, size, color) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('width', size || '50%');
    svg.setAttribute('height', size || '50%');
    svg.style.fill = color || 'currentColor';
    svg.style.pointerEvents = 'none';
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    svg.appendChild(path);
    return svg;
  }

  function throttle(fn, ms) {
    var last = 0;
    return function() {
      var now = Date.now();
      if (now - last >= ms) { last = now; fn.apply(null, arguments); }
    };
  }
`;
