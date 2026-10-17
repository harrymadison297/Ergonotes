// The loading mark before the app's own code has arrived: a head running along a three-petal rose with a fading trail.
// Kept as a separate file (not inline) because the installed app's content-security-policy allows scripts from itself only.
(function () {
  var c = document.getElementById('splash-canvas');
  if (!c || !c.getContext) return;
  var ctx = c.getContext('2d');
  var S = c.width;
  var color = '#2dbe60';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function at(f) {
    var t = f * Math.PI * 2, r = Math.cos(3 * t);
    return [S / 2 + r * Math.cos(t) * (S / 2 - S * 0.14), S / 2 - r * Math.sin(t) * (S / 2 - S * 0.14)];
  }
  function frame(head) {
    ctx.clearRect(0, 0, S, S);
    ctx.globalAlpha = 0.14; ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.beginPath();
    for (var i = 0; i <= 160; i++) { var p = at(i / 160); if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
    ctx.stroke();
    if (reduce) return;
    ctx.fillStyle = color;
    for (var j = 0; j < 40; j++) {
      var k = 1 - j / 40, q = at(head - j * 0.011);
      ctx.globalAlpha = 0.08 + 0.92 * k * k;
      ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(1.2, (S / 22) * (0.35 + 0.65 * k)), 0, 7); ctx.fill();
    }
  }
  if (reduce) { frame(0); return; }
  var start = performance.now();
  (function loop(now) {
    if (!document.getElementById('splash-canvas')) return; // the app has taken over
    frame(((now - start) / 1000 / 4.2) % 1);
    requestAnimationFrame(loop);
  })(start);
})();
