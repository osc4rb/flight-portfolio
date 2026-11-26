/* hud.js - 2D canvas fighter HUD. Classic script, no dependencies.
   window.FlightParts.hud.draw(ctx, w, h, s) - see flight sim notes for the state fields s.
   edgeAngle convention: 0 = screen right, pi/2 = screen down (canvas atan2(dy, dx)). */
(function () {
  'use strict';
  window.FlightParts = window.FlightParts || {};

  var HALO = 'rgba(0,0,0,.55)';
  var DEG = 180 / Math.PI;
  var C, col, small, fs;

  function font(px, wt) {
    C.font = (wt || 600) + ' ' + px + 'px "JetBrains Mono", Consolas, monospace';
  }

  // Build a path with fn, then stroke it twice: dark halo, then HUD colour.
  function stroke(fn, lw) {
    lw = lw || 1.5;
    C.beginPath();
    fn();
    C.lineWidth = lw + 2;
    C.strokeStyle = HALO;
    C.stroke();
    C.lineWidth = lw;
    C.strokeStyle = col;
    C.stroke();
  }

  function text(str, x, y, align, color, size) {
    if (size) font(size);
    C.textAlign = align || 'center';
    C.textBaseline = 'middle';
    C.lineWidth = 3;
    C.strokeStyle = HALO;
    C.lineJoin = 'round';
    C.strokeText(str, x, y);
    C.fillStyle = color || col;
    C.fillText(str, x, y);
  }

  function rect(x, y, bw, bh) {
    stroke(function () { C.rect(x, y, bw, bh); }, 1.25);
  }

  function pad(n, len) {
    var t = String(Math.round(n));
    while (t.length < len) t = '0' + t;
    return t;
  }

  function wrap360(d) { return ((d % 360) + 360) % 360; }

  // ---------- heading tape ----------
  function headingTape(cx, y, hdgDeg, tapeW) {
    var span = 60, ppd = tapeW / span;
    var left = cx - tapeW / 2;
    C.save();
    C.beginPath();
    C.rect(left, y - 4, tapeW, 40);
    C.clip();
    var start = Math.ceil((hdgDeg - span / 2) / 5) * 5;
    stroke(function () {
      for (var a = start; a <= hdgDeg + span / 2; a += 5) {
        var x = cx + (a - hdgDeg) * ppd;
        var major = wrap360(a) % 10 === 0;
        C.moveTo(x, y + 18);
        C.lineTo(x, y + (major ? 10 : 14));
      }
    }, 1.25);
    for (var a = start; a <= hdgDeg + span / 2; a += 5) {
      if (wrap360(a) % 10 !== 0) continue;
      var x = cx + (a - hdgDeg) * ppd;
      if (Math.abs(x - cx) < 18) continue;
      text(pad(wrap360(a) === 0 ? 360 : wrap360(a), 3), x, y + 3, 'center', null, fs);
    }
    C.restore();
    // caret
    stroke(function () {
      C.moveTo(cx - 5, y + 25);
      C.lineTo(cx, y + 19);
      C.lineTo(cx + 5, y + 25);
    }, 1.5);
    var bw = fs * 3 + 10;
    rect(cx - bw / 2, y - 12, bw, 16);
    text(pad(hdgDeg === 0 ? 0 : wrap360(hdgDeg), 3), cx, y - 4, 'center', null, fs);
  }

  // ---------- vertical tapes ----------
  function tape(x, cy, val, step, pxPerUnit, labelEvery, dir, halfH, fmt) {
    // dir -1: labels to the left of the line (speed), +1: labels to the right (altitude)
    var lo = val - halfH / pxPerUnit, hi = val + halfH / pxPerUnit;
    var v0 = Math.ceil(lo / step) * step;
    stroke(function () {
      C.moveTo(x, cy - halfH);
      C.lineTo(x, cy + halfH);
      for (var v = v0; v <= hi; v += step) {
        var y = cy - (v - val) * pxPerUnit;
        var major = Math.round(v / step) % labelEvery === 0;
        C.moveTo(x, y);
        C.lineTo(x - dir * (major ? 9 : 5), y);
      }
    }, 1.25);
    for (var v = v0; v <= hi; v += step) {
      if (Math.round(v / step) % labelEvery !== 0 || v < 0) continue;
      var y = cy - (v - val) * pxPerUnit;
      if (Math.abs(y - cy) < 14) continue;
      text(fmt(v), x + dir * 6, y, dir > 0 ? 'left' : 'right', null, fs - 1);
    }
  }

  function valueBox(x, cy, bw, str, side) {
    // side -1: box ends at x (left of line), +1: box starts at x
    var bx = side < 0 ? x - bw : x;
    rect(bx, cy - 10, bw, 20);
    text(str, bx + bw / 2, cy, 'center', null, fs + 1);
    // pointer
    stroke(function () {
      var px = side < 0 ? x : x;
      C.moveTo(px, cy - 4);
      C.lineTo(px + side * -5, cy);
      C.lineTo(px, cy + 4);
    }, 1.25);
  }

  // ---------- pitch ladder ----------
  function ladder(cx, cy, s, w, h) {
    var ppr = s.pxPerRad || 600;
    var lim = h * (small ? 0.34 : 0.36);
    var half = small ? 26 : 44;
    var gap = small ? 12 : 20;
    var lfs = small ? 9 : 11;
    C.save();
    C.translate(cx, cy);
    C.rotate(-s.bank);
    // clip region (in rotated frame) so lines do not collide with tapes
    C.beginPath();
    C.rect(-w, -lim, w * 2, lim * 2);
    C.clip();
    var yOf = function (deg) { return (s.pitch - deg / DEG) * ppr; };
    // horizon line (split around the boresight)
    var hy = yOf(0);
    var hw = Math.min(w * 0.3, 260);
    stroke(function () {
      C.moveTo(-hw, hy); C.lineTo(-gap - 6, hy);
      C.moveTo(gap + 6, hy); C.lineTo(hw, hy);
    }, 1.75);
    var pd = s.pitch * DEG;
    var d0 = Math.max(-90, Math.floor((pd - lim / ppr * DEG) / 5) * 5);
    var d1 = Math.min(90, Math.ceil((pd + lim / ppr * DEG) / 5) * 5);
    for (var d = d0; d <= d1; d += 5) {
      if (d === 0) continue;
      var y = yOf(d);
      if (Math.abs(y) > lim + 20) continue;
      var up = d > 0;
      var major = d % 10 === 0;
      var hl = major ? half : half * 0.5;
      stroke(function () {
        if (!up) C.setLineDash([5, 4]);
        C.moveTo(-gap - hl, y); C.lineTo(-gap, y);
        C.moveTo(gap, y); C.lineTo(gap + hl, y);
        C.setLineDash([]);
        if (major) {
          var t = up ? 6 : -6;
          C.moveTo(-gap - hl, y); C.lineTo(-gap - hl, y + t);
          C.moveTo(gap + hl, y); C.lineTo(gap + hl, y + t);
        }
      }, 1.25);
      C.setLineDash([]);
      if (major) {
        var lab = String(Math.abs(d));
        text(lab, -gap - hl - 5, y, 'right', null, lfs);
        text(lab, gap + hl + 5, y, 'left', null, lfs);
      }
    }
    C.restore();
  }

  function flightPathMarker(cx, cy, s) {
    var ppr = s.pxPerRad || 600;
    var y = cy - (s.fpa - s.pitch) * ppr;
    var lim = cy * 0.9;
    if (y < cy - lim) y = cy - lim;
    if (y > cy + lim) y = cy + lim;
    var r = small ? 5 : 7;
    stroke(function () {
      C.moveTo(cx + r, y);
      C.arc(cx, y, r, 0, Math.PI * 2);
      C.moveTo(cx - r, y); C.lineTo(cx - r - (small ? 8 : 12), y);
      C.moveTo(cx + r, y); C.lineTo(cx + r + (small ? 8 : 12), y);
      C.moveTo(cx, y - r); C.lineTo(cx, y - r - 7);
    }, 1.75);
  }

  function waterline(cx, cy) {
    var k = small ? 0.8 : 1;
    stroke(function () {
      C.moveTo(cx - 22 * k, cy); C.lineTo(cx - 10 * k, cy);
      C.lineTo(cx - 5 * k, cy + 6 * k); C.lineTo(cx, cy);
      C.lineTo(cx + 5 * k, cy + 6 * k); C.lineTo(cx + 10 * k, cy);
      C.lineTo(cx + 22 * k, cy);
    }, 1.75);
  }

  function bankScale(cx, cy, s, h) {
    var R = h * (small ? 0.4 : 0.42);
    var ticks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
    var base = Math.PI / 2;
    stroke(function () {
      C.arc(cx, cy, R, base - 60 / DEG, base + 60 / DEG);
      for (var i = 0; i < ticks.length; i++) {
        var a = base + ticks[i] / DEG;
        var len = (ticks[i] % 30 === 0 || Math.abs(ticks[i]) === 45) ? 9 : 5;
        C.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        C.lineTo(cx + Math.cos(a) * (R - len), cy + Math.sin(a) * (R - len));
      }
    }, 1.25);
    // pointer rides the horizon: rotates by -bank
    var bk = Math.max(-75 / DEG, Math.min(75 / DEG, s.bank));
    var pa = base - bk;
    var px = cx + Math.cos(pa) * (R + 2), py = cy + Math.sin(pa) * (R + 2);
    stroke(function () {
      var nx = Math.cos(pa), ny = Math.sin(pa);
      var tx = -ny, ty = nx;
      C.moveTo(px, py);
      C.lineTo(px + nx * 9 + tx * 5, py + ny * 9 + ty * 5);
      C.lineTo(px + nx * 9 - tx * 5, py + ny * 9 - ty * 5);
      C.closePath();
    }, 1.5);
    // fixed index at bottom
    stroke(function () {
      C.moveTo(cx, cy + R - 12); C.lineTo(cx - 4, cy + R - 20); C.lineTo(cx + 4, cy + R - 20); C.closePath();
    }, 1.25);
  }

  // ---------- target / autopilot / warning ----------
  function targetMarker(w, h, t) {
    if (!t) return;
    var dist = (t.distNm >= 100 ? t.distNm.toFixed(0) : t.distNm.toFixed(1)) + ' NM';
    if (t.onScreen) {
      var r = small ? 9 : 12;
      stroke(function () {
        C.moveTo(t.sx, t.sy - r); C.lineTo(t.sx + r, t.sy);
        C.lineTo(t.sx, t.sy + r); C.lineTo(t.sx - r, t.sy); C.closePath();
      }, 1.75);
      text(t.name, t.sx, t.sy - r - 9, 'center', null, fs);
      text(dist, t.sx, t.sy + r + 10, 'center', null, fs - 1);
    } else {
      var m = small ? 30 : 44;
      var dx = Math.cos(t.edgeAngle), dy = Math.sin(t.edgeAngle);
      var tx = Math.abs(dx) > 1e-6 ? (w / 2 - m) / Math.abs(dx) : 1e9;
      var ty = Math.abs(dy) > 1e-6 ? (h / 2 - m) / Math.abs(dy) : 1e9;
      var k = Math.min(tx, ty);
      var ex = w / 2 + dx * k, ey = h / 2 + dy * k;
      var sz = small ? 9 : 12;
      stroke(function () {
        C.moveTo(ex + dx * sz, ey + dy * sz);
        C.lineTo(ex - dx * sz * 0.7 - dy * sz * 0.8, ey - dy * sz * 0.7 + dx * sz * 0.8);
        C.lineTo(ex - dx * sz * 0.2, ey - dy * sz * 0.2);
        C.lineTo(ex - dx * sz * 0.7 + dy * sz * 0.8, ey - dy * sz * 0.7 - dx * sz * 0.8);
        C.closePath();
      }, 1.75);
      // label inward of the arrow, kept on screen
      var lx = Math.max(40, Math.min(w - 40, ex - dx * 34));
      var ly = Math.max(14, Math.min(h - 14, ey - dy * 24));
      text(t.name, lx, ly, 'center', null, fs);
      text(dist, lx, ly + fs + 2, 'center', null, fs - 1);
    }
  }

  function warning(w, h, s) {
    var ws = s.warnings;
    if (!ws || !ws.length) return;
    if (Math.floor((s.time || 0) * 6) % 2 !== 0) return;
    text(String(ws[0]), w / 2, h * 0.3, 'center', '#ff4d4d', small ? 22 : 34);
    font(fs);
  }

  // ---------- main ----------
  function draw(ctx, w, h, s) {
    C = ctx;
    col = s.color || '#8dffb0';
    small = s.small != null ? !!s.small : w < 600;
    fs = small ? 10 : 12;
    var cockpit = s.view !== 'chase';
    var cx = w / 2, cy = h / 2;
    var hdgDeg = wrap360(s.heading * DEG);

    C.save();
    C.fillStyle = col;
    C.lineCap = 'round';
    C.lineJoin = 'round';
    C.setLineDash([]);
    font(fs);

    var spd = pad(s.speedKt, 3);
    var alt = String(Math.round(s.altFt));
    var vs = Math.round(s.vsFpm / 10) * 10;
    var vsStr = 'VS ' + (vs >= 0 ? '+' : '-') + Math.abs(vs);
    var bw = small ? 48 : 58;
    var abw = small ? 56 : 66;

    if (cockpit) {
      ladder(cx, cy, s, w, h);
      flightPathMarker(cx, cy, s);
      waterline(cx, cy);
      bankScale(cx, cy, s, h);
      headingTape(cx, small ? 22 : 26, hdgDeg, Math.min(w * 0.5, 320));

      var xs, xa;
      if (small) {
        xs = 8 + bw;
        xa = w - 8 - abw;
      } else {
        xs = cx - Math.min(w * 0.28, 300);
        xa = cx + Math.min(w * 0.28, 300);
        var halfH = Math.min(95, h * 0.2);
        tape(xs, cy, s.speedKt, 10, 1.4, 5, -1, halfH, function (v) { return String(Math.round(v)); });
        tape(xa, cy, s.altFt, 100, 0.14, 5, 1, halfH, function (v) { return String(Math.round(v)); });
      }
      valueBox(xs, cy, bw, spd, -1);
      valueBox(xa, cy, abw, alt, 1);
      text(vsStr, xa + abw / 2, cy + 24, 'center', null, fs);
      if (s.aglFt != null && s.aglFt < 5000) {
        text('R ' + Math.round(s.aglFt), xa + abw / 2, cy + 24 + fs + 3, 'center', null, fs);
      }

      // lower-left: G, Mach, AoA ; lower-right: throttle, AB
      var ly = h - (small ? 78 : 96);
      var lx = small ? 8 : Math.max(10, xs - bw);
      text('G ' + s.g.toFixed(1), lx, ly, 'left', null, fs + 1);
      text('M ' + s.mach.toFixed(2), lx, ly + fs + 4, 'left', null, fs + 1);
      if (!small) text('AOA ' + s.aoaDeg.toFixed(1), lx, ly + 2 * (fs + 4), 'left', null, fs + 1);
      var rx = small ? w - 8 : Math.min(w - 10, xa + abw);
      text('THR ' + Math.round(s.throttle * 100) + '%', rx, ly, 'right', null, fs + 1);
      if (s.afterburner) text('AB', rx, ly + fs + 4, 'right', null, fs + 1);
    } else {
      // chase: lighter readouts
      var ty = small ? 22 : 26;
      var hb = fs * 3 + 14;
      rect(cx - hb / 2, ty - 10, hb, 20);
      text(pad(hdgDeg, 3), cx, ty, 'center', null, fs + 1);
      var by = h - (small ? 40 : 52);
      var gap = small ? 20 : 40;
      rect(cx - gap - bw, by - 10, bw, 20);
      text(spd, cx - gap - bw / 2, by, 'center', null, fs + 1);
      text('KT', cx - gap - bw / 2, by + 17, 'center', null, fs - 1);
      rect(cx + gap, by - 10, abw, 20);
      text(alt, cx + gap + abw / 2, by, 'center', null, fs + 1);
      text('FT ' + vsStr.replace('VS ', ''), cx + gap + abw / 2, by + 17, 'center', null, fs - 1);
      var info = 'M ' + s.mach.toFixed(2) + '  G ' + s.g.toFixed(1) + '  THR ' + Math.round(s.throttle * 100) + (s.afterburner ? ' AB' : '%');
      if (!small) text(info, cx, by - 24, 'center', null, fs);
    }

    if (s.autopilot) {
      text('AUTOPILOT → ' + s.autopilot, cx, cockpit ? (small ? 56 : 66) : (small ? 48 : 54), 'center', null, fs + 1);
    }
    targetMarker(w, h, s.target);
    warning(w, h, s);

    C.restore();
  }

  window.FlightParts.hud = { draw: draw };
})();
