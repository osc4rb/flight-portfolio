/* landmarks.js - low-poly landmark builders for the flight sim.
 * Classic script, no imports. Each builder receives the Three namespace T and returns
 * { group, update(dt, time, night), radius, dispose() }. Origin = ground level under the landmark centre.
 * Geometry is merged into vertex-coloured meshes to keep draw calls low. */
(function () {
  'use strict';
  window.FlightParts = window.FlightParts || {};

  var PI = Math.PI;

  // ---------- helpers ----------
  function Merger(T) {
    this.T = T;
    this.p = []; this.n = []; this.c = [];
    this._m = new T.Matrix4(); this._q = new T.Quaternion(); this._e = new T.Euler();
    this._pos = new T.Vector3(); this._s = new T.Vector3(); this._col = new T.Color();
    this._ub = new T.BoxGeometry(1, 1, 1);
  }
  // add geometry with a transform and a flat colour (or its own 'color' attribute, tinted by colour)
  Merger.prototype.add = function (geo, color, x, y, z, rx, ry, rz, sx, sy, sz) {
    this._pos.set(x || 0, y || 0, z || 0);
    this._q.setFromEuler(this._e.set(rx || 0, ry || 0, rz || 0));
    this._s.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
    this._m.compose(this._pos, this._q, this._s);
    var g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(this._m);
    var pa = g.attributes.position.array, na = g.attributes.normal.array;
    var ca = g.attributes.color ? g.attributes.color.array : null;
    var col = this._col.set(color == null ? 0xffffff : color);
    var i, n = pa.length;
    for (i = 0; i < n; i++) { this.p.push(pa[i]); this.n.push(na[i]); }
    for (i = 0; i < n; i += 3) {
      if (ca) this.c.push(ca[i] * col.r, ca[i + 1] * col.g, ca[i + 2] * col.b);
      else this.c.push(col.r, col.g, col.b);
    }
    g.dispose();
  };
  Merger.prototype.box = function (w, h, d, x, yb, z, color, ry) {
    this.add(this._ub, color, x, yb + h / 2, z, 0, ry || 0, 0, w, h, d);
  };
  Merger.prototype.cyl = function (rt, rb, h, seg, x, yb, z, color, ry, open) {
    var g = new this.T.CylinderGeometry(rt, rb, h, seg, 1, !!open);
    this.add(g, color, x, yb + h / 2, z, 0, ry || 0, 0);
    g.dispose();
  };
  Merger.prototype.mesh = function (mat) {
    var T = this.T, g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    this._ub.dispose();
    return new T.Mesh(g, mat);
  };

  function lam(T, extra) {
    var o = { vertexColors: true, flatShading: true, side: T.DoubleSide };
    for (var k in extra) o[k] = extra[k];
    return new T.MeshLambertMaterial(o);
  }
  // concave, upward-opening dish with its pole at the origin
  function dishGeo(T, R, theta, seg) {
    var g = new T.SphereGeometry(R, seg, 6, 0, PI * 2, PI - theta, theta);
    g.translate(0, R, 0);
    return g;
  }
  // set per-vertex grey level (used as brightness/alpha for additive materials)
  function shade(geo, fn) {
    var p = geo.attributes.position, n = p.count, a = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var k = fn(p.getX(i), p.getY(i), p.getZ(i));
      a[i * 3] = a[i * 3 + 1] = a[i * 3 + 2] = k < 0 ? 0 : k;
    }
    geo.setAttribute('color', new _T.BufferAttribute(a, 3));
    return geo;
  }
  var _T = null;

  function lightSet(T, pts, r) { // pts: [x, y, z, hex]
    var geo = new T.IcosahedronGeometry(r, 0);
    var mat = new T.MeshBasicMaterial({ color: 0xffffff });
    var im = new T.InstancedMesh(geo, mat, pts.length);
    var m = new T.Matrix4(), c = new T.Color();
    for (var i = 0; i < pts.length; i++) {
      m.makeTranslation(pts[i][0], pts[i][1], pts[i][2]);
      im.setMatrixAt(i, m);
      im.setColorAt(i, c.set(pts[i][3]));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    return im;
  }

  function rnd(i) { var s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

  function smoother() {
    var s = { g: 0, step: function (dt, night) {
      var t = night ? 1 : 0;
      s.g += (t - s.g) * Math.min(1, (dt || 0.016) * 3);
      return s.g;
    } };
    return s;
  }

  function finish(group, radius, update) {
    return {
      group: group, radius: radius, update: update,
      dispose: function () {
        group.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach(function (m) { m.dispose(); });
            else o.material.dispose();
          }
          if (o.isInstancedMesh && o.dispose) o.dispose();
        });
        if (group.parent) group.parent.remove(group);
      }
    };
  }

  var HANGAR_WALL = 0xb9b3a6, HANGAR_ROOF = 0x7c8b96, ASPHALT = 0x3b3f45, MARK = 0xf1f0ea;

  // ---------- airbase ----------
  function airbase(T, opts) {
    _T = T;
    opts = opts || {};
    var L = opts.length || 2600, W = opts.width || 45, hw = W / 2, hl = L / 2;
    var group = new T.Group(), M = new Merger(T);
    var rwTop = 0.15, mk = rwTop + 0.02;

    // runway + taxiway + connectors + apron
    M.box(W, rwTop, L, 0, 0, 0, ASPHALT);
    var TX = 110, TW = 23, TL = L - 300;
    M.box(TW, 0.12, TL, TX, 0, 0, 0x454a50);
    var cz = [-900, 900], ci;
    for (ci = 0; ci < 2; ci++) {
      var x0 = hw - 1, x1 = TX - TW / 2 + 1;
      M.box(x1 - x0, 0.12, TW, (x0 + x1) / 2, 0, cz[ci], 0x454a50);
    }
    M.box(180, 0.1, 260, TX + TW / 2 + 90 - 1, 0, -300, 0x4d5258);

    // runway markings
    var i, z, sgn;
    for (sgn = -1; sgn <= 1; sgn += 2) {
      for (i = 0; i < 8; i++) M.box(2, 0.04, 30, (i - 3.5) * 4.6, mk - 0.0, sgn * (hl - 25), MARK);
      M.box(W - 4, 0.04, 2, 0, mk, sgn * (hl - 44), MARK);
      // aiming point and touchdown bars
      M.box(5, 0.04, 45, -9, mk, sgn * (hl - 400), MARK);
      M.box(5, 0.04, 45, 9, mk, sgn * (hl - 400), MARK);
      M.box(3, 0.04, 22, -8, mk, sgn * (hl - 520), MARK);
      M.box(3, 0.04, 22, 8, mk, sgn * (hl - 520), MARK);
    }
    for (z = -hl + 100; z < hl - 90; z += 60) M.box(1, 0.04, 30, 0, mk, z, MARK);
    M.box(0.8, 0.04, L - 40, -hw + 1.5, mk, 0, MARK);
    M.box(0.8, 0.04, L - 40, hw - 1.5, mk, 0, MARK);
    M.box(0.6, 0.03, TL - 40, TX, 0.13, 0, 0xe0b84a);

    // hangars (arched roof along x, doors face -x), small buildings, tanks
    var half = new T.CylinderGeometry(20, 20, 50, 10, 1, true, 0, PI);
    half.rotateZ(PI / 2);
    var cap = new T.CircleGeometry(20, 10, 0, PI);
    cap.rotateY(PI / 2);
    for (i = 0; i < 3; i++) {
      var hz = -360 + i * 60, hx = 260;
      M.box(50, 8, 40, hx, 0, hz, HANGAR_WALL);
      M.add(half, HANGAR_ROOF, hx, 8, hz, 0, 0, 0, 1, 0.35, 1);
      M.add(cap, HANGAR_WALL, hx - 25, 8, hz, 0, 0, 0, 1, 0.35, 1);
      M.add(cap, HANGAR_WALL, hx + 25, 8, hz, 0, 0, 0, 1, 0.35, 1);
      M.box(0.4, 7, 28, hx - 25.1, 0, hz, 0x3a3f45);
    }
    half.dispose(); cap.dispose();
    M.box(24, 7, 14, 170, 0, -110, 0xcfc9bb); M.box(25, 0.8, 15, 170, 7, -110, HANGAR_ROOF);
    M.box(14, 5, 14, 215, 0, -75, 0xd8d2c4); M.box(15, 0.8, 15, 215, 5, -75, 0x8a8f94);
    M.box(10, 4, 10, 165, 0, -60, 0xb9b3a6); M.box(11, 0.6, 11, 165, 4, -60, HANGAR_ROOF);
    M.cyl(5, 5, 6, 8, 320, 0, -110, 0xf3f3ef);
    M.cyl(5, 5, 6, 8, 335, 0, -95, 0xf3f3ef);
    M.cyl(0, 5.4, 1.2, 8, 320, 6, -110, 0x8a8f94);
    M.cyl(0, 5.4, 1.2, 8, 335, 6, -95, 0x8a8f94);

    var body = M.mesh(lam(T, {}));
    group.add(body);

    // edge lights
    var pts = [], BLUE = 0x4aa3ff, WHT = 0xfff4d6, GRN = 0x4cff7a, RED = 0xff4a3a;
    for (z = -hl; z <= hl + 0.1; z += 60) {
      pts.push([-hw - 1.5, 0.7, z, WHT], [hw + 1.5, 0.7, z, WHT]);
    }
    for (i = -5; i <= 5; i++) {
      pts.push([i * 4, 0.7, -hl - 3, GRN], [i * 4, 0.7, hl + 3, RED]);
    }
    for (z = -TL / 2; z <= TL / 2 + 0.1; z += 60) {
      pts.push([TX - TW / 2 - 1.5, 0.6, z, BLUE], [TX + TW / 2 + 1.5, 0.6, z, BLUE]);
    }
    var lights = lightSet(T, pts, 1.1);
    group.add(lights);

    var sm = smoother();
    return finish(group, Math.max(hl, 330), function (dt, time, night) {
      var g = sm.step(dt, night);
      lights.material.color.setScalar(0.35 + 0.65 * g);
    });
  }

  // ---------- control tower ----------
  function tower(T) {
    _T = T;
    var group = new T.Group(), M = new Merger(T);
    M.box(18, 6, 16, 0, 0, 0, 0xd9d4c7);
    M.box(19, 0.8, 17, 0, 6, 0, 0x8a8f94);
    M.box(6, 3, 6, 11, 0, 4, 0xcfc9bb);
    M.cyl(2.8, 4, 34, 8, 0, 0, 0, 0xd9d4c7, PI / 8);
    M.cyl(7.6, 7.6, 0.8, 8, 0, 34, 0, 0x3b3f45, PI / 8);
    M.cyl(7.2, 7.2, 1.1, 8, 0, 34.8, 0, 0x2a2d32, PI / 8, true);
    M.cyl(2.2, 8.4, 1.6, 8, 0, 39.2, 0, 0x8a8f94, PI / 8);
    M.cyl(0.25, 0.25, 8, 4, 0, 40.8, 0, 0xc94b3b);
    M.cyl(0.15, 0.15, 5, 4, 3.5, 40.8, 0, 0xf1f0ea);
    group.add(M.mesh(lam(T, {})));

    var glassG = new T.CylinderGeometry(7, 6, 4.4, 8, 1, false);
    glassG.translate(0, 36.8, 0); glassG.rotateY(PI / 8);
    var glassMat = new T.MeshLambertMaterial({ color: 0x2c4a63, flatShading: true, emissive: 0xffc870, emissiveIntensity: 0.05 });
    group.add(new T.Mesh(glassG, glassMat));

    var blink = lightSet(T, [[0, 49.2, 0, 0xffffff]], 0.9);
    group.add(blink);

    var sm = smoother();
    return finish(group, 40, function (dt, time, night) {
      var g = sm.step(dt, night);
      glassMat.emissiveIntensity = 0.05 + 1.4 * g;
      blink.material.color.setHex((time % 1) < 0.5 ? 0xff2a1a : 0x2a0805);
    });
  }

  // ---------- radar site ----------
  function radar(T) {
    _T = T;
    var group = new T.Group(), M = new Merger(T);
    M.cyl(15, 17, 8, 12, 0, 0, 0, 0x9aa0a5);
    M.cyl(18, 18, 0.8, 12, 0, 8, 0, 0x6b7076);
    var ico = new T.IcosahedronGeometry(18, 1);
    M.add(ico, 0xf3f3ef, 0, 21, 0, 0, 0, 0, 1, 0.95, 1);
    ico.dispose();
    M.box(16, 5, 10, -38, 0, 14, 0xd9d4c7); M.box(17, 0.7, 11, -38, 5, 14, 0x7c8b96);
    M.box(8, 3.5, 8, -38, 0, -6, 0xcfc9bb);
    // pylon
    M.cyl(1.6, 3.2, 26, 4, 50, 0, 0, 0xc9c9c4, PI / 4);
    M.box(5, 0.6, 5, 50, 26, 0, 0x8a8f94);
    M.cyl(1.2, 1.2, 1.6, 8, 50, 26.6, 0, 0x6b7076);
    // two small dishes on posts
    var dg = dishGeo(T, 6, 0.9, 10);
    M.cyl(0.6, 0.9, 6, 6, 32, 0, 36, 0xc9c9c4);
    M.add(dg, 0xf1f0ea, 32, 6, 36, -0.5, 0.4, 0);
    M.cyl(0.6, 0.9, 5, 6, 12, 0, 40, 0xc9c9c4);
    M.add(dg, 0xf1f0ea, 12, 5, 40, -0.6, -0.5, 0.1, 0.8, 0.8, 0.8);
    dg.dispose();
    group.add(M.mesh(lam(T, {})));

    // rotating antenna
    var A = new Merger(T);
    A.box(1.2, 8.5, 24, 0, 0, 0, 0xe8e8e4);
    A.box(0.5, 1.2, 24.4, -0.4, 7.6, 0, 0xc94b3b);
    A.box(5.5, 0.5, 0.5, 3.2, 4, 0, 0x6b7076);
    A.box(1.2, 1.2, 2.2, 6, 3.6, 0, 0x6b7076);
    A.box(2.4, 2, 2.4, -1.6, -1.6, 0, 0x6b7076);
    var ant = A.mesh(lam(T, {}));
    var pivot = new T.Group();
    pivot.position.set(50, 28.2, 0);
    ant.position.y = 0.2;
    pivot.add(ant);
    group.add(pivot);

    var blink = lightSet(T, [[50, 40, 0, 0xffffff]], 0.9);
    group.add(blink);
    var spin = 2 * PI / 4;
    return finish(group, 90, function (dt, time, night) {
      pivot.rotation.y = time * spin;
      blink.material.color.setHex((time % 1) < 0.5 ? 0xff2a1a : 0x2a0805);
    });
  }

  // ---------- antenna farm ----------
  function antennas(T) {
    _T = T;
    var group = new T.Group(), M = new Merger(T);
    var RED = 0xc94b3b, WHT = 0xf1f0ea, pts = [], i, s;
    var cols = [-105, -35, 35, 105], rows = [-90, 0, 90];
    for (i = 0; i < 12; i++) {
      var x = cols[i % 4] + (rnd(i) - 0.5) * 26;
      var z = rows[(i / 4) | 0] + (rnd(i + 40) - 0.5) * 26;
      var h = 40 + rnd(i + 80) * 30;
      var secs = 5, sh = h / secs, rb = 1.4, rt = 0.45;
      for (s = 0; s < secs; s++) {
        var r0 = rb + (rt - rb) * (s / secs), r1 = rb + (rt - rb) * ((s + 1) / secs);
        M.cyl(r1, r0, sh, 4, x, s * sh, z, s % 2 ? WHT : RED, PI / 4, true);
      }
      M.box(7, 0.35, 0.35, x, h * 0.45, z, 0x6b7076, 0);
      M.box(0.35, 0.35, 7, x, h * 0.62, z, 0x6b7076, 0);
      M.box(5, 0.3, 0.3, x, h * 0.8, z, 0x6b7076, PI / 4);
      M.cyl(0.12, 0.12, 4.5, 4, x, h, z, 0x2a2d32);
      M.box(2.6, 0.6, 2.6, x, 0, z, 0x6b7076);
      pts.push([x, h + 4.8, z, 0xff3a2a], [x, h * 0.5, z, 0xff3a2a]);
    }
    // control building
    M.box(22, 6, 12, 0, 0, -48, 0xd9d4c7);
    M.box(23, 0.8, 13, 0, 6, -48, 0x7c8b96);
    M.box(4, 3, 0.4, -5, 0, -41.9, 0x3a3f45);
    M.box(6, 2.5, 5, 15, 0, -50, 0xcfc9bb);
    // big dish
    var R = 22, th = 0.85;
    M.cyl(4.5, 6.5, 7, 8, 0, 0, 0, 0xcfc9bb);
    var dg = dishGeo(T, R, th, 18);
    M.add(dg, 0xf3f3ef, 0, 7, 0, 0, 0, 0);
    dg.dispose();
    var rim = R * Math.sin(th);
    for (i = 0; i < 3; i++) {
      var a = i * 2 * PI / 3 + 0.5;
      M.add(M._ub, 0x6b7076, Math.cos(a) * rim * 0.5, 7 + 15, Math.sin(a) * rim * 0.5, 0.0, -a, 0.0, 0.5, 0.5, 0.5);
    }
    M.cyl(0.4, 0.4, 12, 4, 0, 7, 0, 0x6b7076);
    M.cyl(1.6, 0.6, 3, 6, 0, 19, 0, 0xc94b3b);
    group.add(M.mesh(lam(T, {})));

    var blink = lightSet(T, pts, 1.1);
    group.add(blink);
    return finish(group, 170, function (dt, time) {
      blink.material.color.setHex((time % 1) < 0.5 ? 0xff2a1a : 0x2a0805);
    });
  }

  // ---------- lighthouse ----------
  function lighthouse(T) {
    _T = T;
    var group = new T.Group(), M = new Merger(T);
    var ROCK = 0x7b766c, i;
    var ico = new T.IcosahedronGeometry(14, 1);
    M.add(ico, ROCK, 0, 0, 0, 0, 0.3, 0, 1, 0.45, 1);
    var rocks = [[16, -4, 6, 0.1], [-14, 9, 5.5, 0.7], [-6, -16, 6.5, 1.3], [12, 15, 4.5, 2.0]];
    for (i = 0; i < rocks.length; i++) {
      var r = rocks[i], s = r[2] / 14;
      M.add(ico, i % 2 ? 0x6e695f : ROCK, r[0], 0, r[1], 0, r[3], 0, s, s * 0.7, s);
    }
    ico.dispose();
    var bands = 5, y0 = 4, y1 = 34, r0 = 4.6, r1 = 3.0, bh = (y1 - y0) / bands;
    for (i = 0; i < bands; i++) {
      var ra = r0 + (r1 - r0) * (i / bands), rb = r0 + (r1 - r0) * ((i + 1) / bands);
      M.cyl(rb, ra, bh, 10, 0, y0 + i * bh, 0, i % 2 ? 0xf5f0e1 : 0xd9533f);
    }
    M.cyl(4.4, 3.4, 0.9, 10, 0, 34, 0, 0x3b3f45);
    M.cyl(4.2, 4.2, 1.1, 10, 0, 34.9, 0, 0x2a2d32, 0, true);
    M.cyl(0, 3.1, 2.4, 10, 0, 39, 0, 0xd9533f);
    M.cyl(0.5, 0.5, 0.6, 6, 0, 41.2, 0, 0x2a2d32);
    M.box(1.6, 2.6, 0.4, 0, 4, 3.6, 0x3a3f45);
    group.add(M.mesh(lam(T, {})));

    var lampG = new T.CylinderGeometry(2.3, 2.3, 3.2, 8, 1, false);
    lampG.translate(0, 37.4, 0);
    var lampMat = new T.MeshLambertMaterial({ color: 0xcfe6f2, flatShading: true, emissive: 0xffe08a, emissiveIntensity: 0.15 });
    group.add(new T.Mesh(lampG, lampMat));

    // beams: two additive cones with distance fade
    var len = 380, rad = 26;
    var cone = new T.ConeGeometry(rad, len, 12, 1, true);
    cone.translate(0, -len / 2, 0);
    cone.rotateZ(PI / 2); // apex at origin, opens toward +x
    shade(cone, function (x) { var t = x / len; return Math.pow(Math.max(0, 1 - t), 1.4); });
    var B = new Merger(T);
    B.add(cone, 0xfff1c0, 0, 0, 0, 0, 0, 0);
    B.add(cone, 0xfff1c0, 0, 0, 0, 0, PI, 0);
    cone.dispose();
    var beamMat = new T.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.06, blending: T.AdditiveBlending,
      depthWrite: false, side: T.DoubleSide
    });
    var beam = B.mesh(beamMat);
    beam.frustumCulled = false;
    var pivot = new T.Group();
    pivot.position.y = 37.4;
    pivot.add(beam);
    group.add(pivot);

    var sm = smoother();
    return finish(group, 40, function (dt, time, night) {
      var g = sm.step(dt, night);
      pivot.rotation.y = time * (2 * PI / 6);
      beamMat.opacity = 0.05 + 0.5 * g;
      lampMat.emissiveIntensity = 0.15 + 1.6 * g;
    });
  }

  // ---------- beacon ----------
  function beacon(T, color) {
    _T = T;
    var group = new T.Group();
    var H = 1500, tint = new T.Color(color == null ? 0xffd24a : color);
    var M = new Merger(T);
    var core = new T.CylinderGeometry(5, 7, H, 10, 1, true);
    core.translate(0, H / 2, 0);
    shade(core, function (x, y) { return 1.0 - 0.7 * (y / H); });
    var halo = new T.CylinderGeometry(14, 18, H, 10, 1, true);
    halo.translate(0, H / 2, 0);
    shade(halo, function (x, y) { return 0.3 * (1.0 - 0.8 * (y / H)); });
    var ring = new T.CircleGeometry(80, 28);
    ring.rotateX(-PI / 2);
    shade(ring, function (x, y, z) { return Math.max(0, 1 - Math.sqrt(x * x + z * z) / 80) * 0.9; });
    M.add(core, tint.getHex(), 0, 0, 0);
    M.add(halo, tint.getHex(), 0, 0, 0);
    M.add(ring, tint.getHex(), 0, 2, 0);
    core.dispose(); halo.dispose(); ring.dispose();
    var mat = new T.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.4, blending: T.AdditiveBlending,
      depthWrite: false, fog: false, side: T.DoubleSide
    });
    var mesh = M.mesh(mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    var sm = smoother();
    return finish(group, 80, function (dt, time, night) {
      var g = sm.step(dt, night);
      mat.opacity = 0.4 + 0.35 * g + 0.06 * Math.sin(time * 2.0);
    });
  }

  window.FlightParts.landmarks = {
    airbase: airbase, tower: tower, radar: radar, antennas: antennas, lighthouse: lighthouse, beacon: beacon
  };
})();
