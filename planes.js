/* planes.js — low-poly aircraft for the flight sim.
   Classic script, no imports: each build(T) receives the Three.js namespace.
   Units: metres. Nose -Z, right wing +X, up +Y, origin near the centre of gravity.
   Control surfaces: rotation.x > 0 = trailing edge down (both sides, all-moving surfaces too);
   rudders: rotation.y > 0 = trailing edge toward +X (nose right). */
(function () {
  'use strict';

  const DEG = Math.PI / 180;

  /* Shared toolkit: tracks every geometry/material so dispose() can free them. */
  function kit(T) {
    const geos = [];
    const mats = [];
    const keepG = (g) => { geos.push(g); return g; };
    const keepM = (m) => { mats.push(m); return m; };
    const lambert = (color, extra) => keepM(new T.MeshLambertMaterial(
      Object.assign({ color, flatShading: true, side: T.DoubleSide }, extra || {})));
    const basic = (color, extra) => keepM(new T.MeshBasicMaterial(Object.assign({ color }, extra || {})));

    function tri(pos, a, b, c) { pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
    function centroid(r) {
      const c = [0, 0, 0];
      r.forEach((p) => { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; });
      return [c[0] / r.length, c[1] / r.length, c[2] / r.length];
    }
    function fan(pos, ring, flip) {
      const c = centroid(ring);
      for (let j = 0; j < ring.length; j++) {
        const k = (j + 1) % ring.length;
        if (flip) tri(pos, c, ring[k], ring[j]); else tri(pos, c, ring[j], ring[k]);
      }
    }
    function fromTris(pos) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      return keepG(g);
    }
    /* Skin a list of closed rings (same point count) into one faceted surface. */
    function loft(rings, capA, capB) {
      const pos = [];
      const n = rings[0].length;
      for (let i = 0; i < rings.length - 1; i++) {
        const A = rings[i], B = rings[i + 1];
        for (let j = 0; j < n; j++) {
          const k = (j + 1) % n;
          tri(pos, A[j], B[j], B[k]);
          tri(pos, A[j], B[k], A[k]);
        }
      }
      if (capA) fan(pos, rings[0], true);
      if (capB) fan(pos, rings[rings.length - 1], false);
      return fromTris(pos);
    }
    function polygon(ring) { const pos = []; fan(pos, ring, false); return fromTris(pos); }
    const mirror = (rings) => rings.map((r) => r.map((p) => [-p[0], p[1], p[2]]));

    function add(parent, geo, mat, name) {
      const o = new T.Mesh(geo, mat);
      if (name) o.name = name;
      parent.add(o);
      return o;
    }
    /* Mesh on a pivot whose local X (or Y) runs along the hinge p1 -> p2. The returned mesh is the
       part: its rotation.x (or .y) is the deflection. Geometry is given in parent coordinates. */
    function hinged(parent, geo, mat, p1, p2, axis, name) {
      const a = new T.Vector3(p1[0], p1[1], p1[2]);
      const dir = new T.Vector3(p2[0], p2[1], p2[2]).sub(a).normalize();
      const pivot = new T.Group();
      pivot.position.copy(a);
      pivot.quaternion.setFromUnitVectors(axis === 'y' ? new T.Vector3(0, 1, 0) : new T.Vector3(1, 0, 0), dir);
      pivot.updateMatrix();
      geo.applyMatrix4(pivot.matrix.clone().invert());
      parent.add(pivot);
      return add(pivot, geo, mat, name);
    }

    /* Fuselage ring: 12 points, sharp chine at (±w, cy), flat-ish top and V belly. */
    function ring12(z, w, top, bot, cy) {
      const up = top - cy, dn = bot - cy;
      const R = [
        [w * 0.55, cy + up * 0.82], [w * 0.9, cy + up * 0.35], [w, cy],
        [w * 0.88, cy + dn * 0.4], [w * 0.55, cy + dn * 0.85],
      ];
      const pts = [[0, top, z]];
      R.forEach((p) => pts.push([p[0], p[1], z]));
      pts.push([0, bot, z]);
      for (let i = R.length - 1; i >= 0; i--) pts.push([-R[i][0], R[i][1], z]);
      return pts;
    }
    /* Lifting-surface section: span along X, chord along Z, thickness along Y. */
    function wsec(x, y, le, te, t) {
      const c = te - le;
      return [[x, y, le], [x, y + t * 0.5, le + c * 0.25], [x, y + t * 0.32, le + c * 0.65],
        [x, y, te], [x, y - t * 0.2, le + c * 0.65], [x, y - t * 0.32, le + c * 0.25]];
    }
    /* Fin section: span along Y, chord along Z, thickness along X. */
    function fsec(y, le, te, t) {
      const c = te - le;
      return [[0, y, le], [t * 0.5, y, le + c * 0.3], [t * 0.3, y, le + c * 0.7],
        [0, y, te], [-t * 0.3, y, le + c * 0.7], [-t * 0.5, y, le + c * 0.3]];
    }

    /* One wing side. at(x) -> {y, le, te, t} for the right side; s = +1 right, -1 left.
       layout: panels {xs:[...]} or cut panels {xs:[x0,x1], cut, name} that get a hinged surface. */
    function wing(parent, at, s, layout, mat, accent) {
      const parts = {};
      const side = (r) => (s < 0 ? mirror(r) : r);
      layout.forEach((p) => {
        const cut = p.cut || 0;
        const rings = p.xs.map((x) => { const a = at(x); return wsec(x, a.y, a.le, a.te - cut, a.t); });
        add(parent, loft(side(rings), true, true), mat);
        if (!cut) return;
        const ends = [p.xs[0], p.xs[p.xs.length - 1]];
        const fr = ends.map((x) => { const a = at(x); return wsec(x, a.y, a.te - cut, a.te, a.t * 0.28); });
        const hp = ends.map((x) => { const a = at(x); return [x * s, a.y, a.te - cut]; });
        const name = p.name + (s > 0 ? 'R' : 'L');
        parts[name] = hinged(parent, loft(side(fr), true, true), accent,
          s > 0 ? hp[0] : hp[1], s > 0 ? hp[1] : hp[0], 'x', name);
      });
      return parts;
    }
    /* All-moving surface (stabilator / canard) pivoting on a spanwise spindle at z = spindleZ. */
    function allMoving(parent, at, xs, spindleZ, s, mat, name) {
      const rings = xs.map((x) => { const a = at(x); return wsec(x, a.y, a.le, a.te, a.t); });
      const hp = [xs[0], xs[xs.length - 1]].map((x) => [x * s, at(x).y, spindleZ]);
      return hinged(parent, loft(s < 0 ? mirror(rings) : rings, true, true), mat,
        s > 0 ? hp[0] : hp[1], s > 0 ? hp[1] : hp[0], 'x', name);
    }
    /* Canted fin with a rudder. at(y) -> {le, te, t}; ys = [root, tip]; rud = [y0, y1, chord]. */
    function fin(parent, pos, cant, at, ys, rud, mat, accent, name) {
      const grp = new T.Group();
      grp.position.set(pos[0], pos[1], pos[2]);
      grp.rotation.z = cant;
      parent.add(grp);
      const sec = (y, cut) => { const a = at(y); return fsec(y, a.le, a.te - cut, a.t); };
      add(grp, loft([sec(ys[0], 0), sec(rud[0], 0)], true, true), mat);
      add(grp, loft([sec(rud[0], rud[2]), sec(rud[1], rud[2])], true, true), mat);
      add(grp, loft([sec(rud[1], 0), sec(ys[1], 0)], true, true), mat);
      const rr = [rud[0], rud[1]].map((y) => { const a = at(y); return fsec(y, a.te - rud[2], a.te, a.t * 0.28); });
      const hp = [rud[0], rud[1]].map((y) => [0, y, at(y).te - rud[2]]);
      return hinged(grp, loft(rr, true, true), accent, hp[0], hp[1], 'y', name);
    }
    /* Intake: open lofted duct plus a dark face just inside the lip. */
    function intake(parent, rings, s, mat, holeMat) {
      const r = s < 0 ? mirror(rings) : rings;
      add(parent, loft(r, false, false), mat);
      const lip = r[0], c = centroid(lip);
      const face = lip.map((p) => [c[0] + (p[0] - c[0]) * 0.86, c[1] + (p[1] - c[1]) * 0.86, p[2] + 0.14]);
      add(parent, polygon(face), holeMat);
    }

    let coneGeo = null;
    /* Afterburner plume: 1 unit long along +Z from the nozzle exit, base radius 0.5.
       It sits in a holder scaled (sx, sy, len) so 1 unit of burner.scale.z = len metres. */
    function burner(parent, pos, sx, sy, len) {
      if (!coneGeo) {
        coneGeo = keepG(new T.CylinderGeometry(0.06, 0.5, 1, 12, 1, true));
        coneGeo.rotateX(Math.PI / 2);
        coneGeo.translate(0, 0, 0.5);
      }
      const mat = basic(0xff8a2a, {
        transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide,
      });
      const holder = new T.Group();
      holder.position.set(pos[0], pos[1], pos[2]);
      holder.scale.set(sx, sy, len);
      parent.add(holder);
      const b = add(holder, coneGeo, mat, 'burner');
      b.scale.z = 0.6;
      const core = add(b, coneGeo, mat, 'burner-core'); // same material: fades with the caller's opacity
      core.scale.set(0.55, 0.55, 0.55);
      return b;
    }
    function lights(group, tipL, tipR, strobePos) {
      const bulb = keepG(new T.SphereGeometry(0.08, 6, 4));
      const navL = add(group, bulb, basic(0xff2a2a), 'nav-red');
      navL.position.set(tipL[0], tipL[1], tipL[2]);
      const navR = add(group, bulb, basic(0x22ff55), 'nav-green');
      navR.position.set(tipR[0], tipR[1], tipR[2]);
      const strobe = add(group, keepG(new T.BoxGeometry(0.12, 0.07, 0.2)), basic(0xffffff), 'strobe');
      strobe.position.set(strobePos[0], strobePos[1], strobePos[2]);
      return { navL, navR, strobe };
    }
    function canopyMat() {
      return keepM(new T.MeshPhongMaterial({
        color: 0x1b2533, emissive: 0x3a2c0c, specular: 0xd9b45a, shininess: 90, flatShading: true,
      }));
    }
    function canopy(group, mat, pos, scale) {
      const c = add(group, keepG(new T.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), mat, 'canopy');
      c.position.set(pos[0], pos[1], pos[2]);
      c.scale.set(scale[0], scale[1], scale[2]);
      return c;
    }
    function dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      geos.length = 0;
      mats.length = 0;
    }

    return {
      keepG, keepM, lambert, basic, loft, polygon, add, hinged, ring12, wsec, wing, allMoving, fin,
      intake, burner, lights, canopyMat, canopy, dispose,
    };
  }

  /* ---------------- F-35A Lightning II: 15.7 m long, 10.7 m span ---------------- */
  function buildF35(T) {
    const K = kit(T);
    const group = new T.Group();
    group.name = 'F-35A';
    const skin = K.lambert(0x7f868e);
    const panel = K.lambert(0x6c737b);
    const metal = K.lambert(0x43484f);
    const hole = K.basic(0x14171b, { side: T.DoubleSide });
    const glass = K.canopyMat();

    // Fuselage stations: [z, chine half-width, top, bottom, chine y]
    const ST = [
      [-8.05, 0.03, 0.12, 0.05, 0.08],
      [-7.5, 0.32, 0.32, -0.12, 0.06],
      [-6.6, 0.58, 0.55, -0.3, 0.05],
      [-5.6, 0.76, 0.72, -0.45, 0.06],
      [-4.4, 0.92, 0.8, -0.55, 0.1],
      [-3.4, 1.12, 0.86, -0.6, 0.15],
      [-2.0, 1.45, 0.95, -0.66, 0.2],
      [-0.4, 1.62, 0.98, -0.7, 0.2],
      [1.6, 1.62, 0.95, -0.68, 0.2],
      [3.4, 1.5, 0.9, -0.62, 0.2],
      [4.9, 1.28, 0.82, -0.55, 0.18],
      [6.0, 0.98, 0.74, -0.5, 0.14],
      [6.7, 0.74, 0.7, -0.52, 0.1],
    ];
    K.add(group, K.loft(ST.map((s) => K.ring12(s[0], s[1], s[2], s[3], s[4])), true, true), skin, 'fuselage');

    K.canopy(group, glass, [0, 0.6, -4.9], [0.46, 0.46, 1.5]);
    const eots = K.add(group, K.keepG(new T.OctahedronGeometry(0.14, 0)), glass, 'eots');
    eots.position.set(0, -0.3, -6.5);
    eots.scale.set(1, 0.7, 1.6);

    // Caret intakes (raked lips), right side; mirrored for the left.
    const INT = [
      [[0.7, 0.58, -4.25], [1.28, 0.36, -3.85], [1.22, -0.34, -3.5], [0.7, -0.36, -3.85]],
      [[0.72, 0.62, -2.6], [1.42, 0.36, -2.6], [1.36, -0.42, -2.6], [0.72, -0.44, -2.6]],
      [[0.78, 0.55, -0.9], [1.55, 0.3, -0.9], [1.5, -0.45, -0.9], [0.78, -0.48, -0.9]],
    ];
    K.intake(group, INT, 1, panel, hole);
    K.intake(group, INT, -1, panel, hole);

    // Trapezoidal wing: LE sweep ~33 deg, forward-swept TE, flaperons as the roll surfaces.
    const wAt = (x) => {
      const f = (x - 1.0) / 4.35;
      return { y: 0.18 - 0.12 * f, le: -1.2 + 2.82 * f, te: 4.6 - 1.4 * f, t: 0.4 - 0.33 * f };
    };
    const WL = [{ xs: [1.0, 2.0] }, { xs: [2.0, 4.55], cut: 0.75, name: 'ail' }, { xs: [4.55, 5.35] }];
    const wr = K.wing(group, wAt, 1, WL, skin, panel);
    const wl = K.wing(group, wAt, -1, WL, skin, panel);

    // All-moving horizontal stabilators.
    const sAt = (x) => {
      const f = (x - 0.75) / 2.6;
      return { y: 0.15, le: 4.9 + 1.65 * f, te: 7.65 - 0.25 * f, t: 0.16 - 0.11 * f };
    };
    const elevR = K.allMoving(group, sAt, [0.75, 3.35], 6.3, 1, skin, 'elevR');
    const elevL = K.allMoving(group, sAt, [0.75, 3.35], 6.3, -1, skin, 'elevL');

    // Twin vertical tails canted 25 deg outboard.
    const fAt = (y) => {
      const f = (y + 0.2) / 2.3;
      return { le: 3.55 + 1.6 * f, te: 6.4 + 0.35 * f, t: 0.16 - 0.11 * f };
    };
    const rudR = K.fin(group, [0.7, 0.5, 0], -25 * DEG, fAt, [-0.2, 2.1], [0.25, 1.75, 0.6], skin, panel, 'rudR');
    const rudL = K.fin(group, [-0.7, 0.5, 0], 25 * DEG, fAt, [-0.2, 2.1], [0.25, 1.75, 0.6], skin, panel, 'rudL');

    // Single engine nozzle, faceted, with a hot inner face.
    const nz = K.keepG(new T.CylinderGeometry(0.5, 0.64, 0.95, 14, 1, true));
    nz.rotateX(Math.PI / 2);
    nz.translate(0, 0.1, 7.05);
    K.add(group, nz, metal, 'nozzle');
    const hot = K.add(group, K.keepG(new T.CircleGeometry(0.47, 14)), K.basic(0x5a2208), 'nozzle-hot');
    hot.position.set(0, 0.1, 7.3);
    const burner = K.burner(group, [0, 0.1, 7.52], 1, 1, 3.0);

    const L = K.lights(group, [-5.38, 0.06, 1.9], [5.38, 0.06, 1.9], [0, 0.94, 3.0]);

    return {
      group,
      burner,
      burners: [burner],
      tips: [new T.Vector3(-5.35, 0.06, 2.4), new T.Vector3(5.35, 0.06, 2.4)],
      eye: new T.Vector3(0, 0.9, -4.8),
      strobe: L.strobe,
      navL: L.navL,
      navR: L.navR,
      parts: { elevL, elevR, ailL: wl.ailL, ailR: wr.ailR, rudL, rudR },
      dispose: K.dispose,
    };
  }

  /* ---------------- F-47 concept: ~19.3 m long, 13 m span (stylized from the public render) ---------------- */
  function buildF47(T) {
    const K = kit(T);
    const group = new T.Group();
    group.name = 'F-47 concept';
    const skin = K.lambert(0x5c636c);
    const panel = K.lambert(0x4e555d);
    const metal = K.lambert(0x30343a);
    const hole = K.basic(0x111316, { side: T.DoubleSide });
    const glass = K.canopyMat();

    // Long chined stealth nose blending into a wide, flat body.
    const ST = [
      [-10.0, 0.03, 0.1, 0.04, 0.06],
      [-9.2, 0.34, 0.26, -0.12, 0.04],
      [-8.0, 0.66, 0.46, -0.28, 0.04],
      [-6.8, 0.92, 0.62, -0.4, 0.06],
      [-5.4, 1.16, 0.74, -0.5, 0.1],
      [-3.8, 1.42, 0.8, -0.56, 0.12],
      [-2.0, 1.62, 0.84, -0.6, 0.12],
      [0.5, 1.76, 0.84, -0.6, 0.12],
      [3.2, 1.72, 0.78, -0.56, 0.12],
      [5.6, 1.56, 0.66, -0.48, 0.12],
      [7.4, 1.36, 0.52, -0.38, 0.12],
      [8.6, 1.24, 0.42, -0.24, 0.14],
    ];
    K.add(group, K.loft(ST.map((s) => K.ring12(s[0], s[1], s[2], s[3], s[4])), true, true), skin, 'fuselage');

    K.canopy(group, glass, [0, 0.5, -6.3], [0.42, 0.4, 1.8]);

    // Trapezoidal intakes tucked under the chine.
    const INT = [
      [[0.5, -0.05, -3.9], [1.35, -0.05, -3.5], [1.15, -0.6, -3.3], [0.5, -0.65, -3.6]],
      [[0.5, 0.0, -2.0], [1.55, 0.0, -2.0], [1.32, -0.66, -2.0], [0.5, -0.7, -2.0]],
      [[0.5, 0.05, -0.4], [1.7, 0.05, -0.4], [1.42, -0.6, -0.4], [0.5, -0.65, -0.4]],
    ];
    K.intake(group, INT, 1, panel, hole);
    K.intake(group, INT, -1, panel, hole);

    // Forward canards with dihedral.
    const cAt = (x) => {
      const f = (x - 0.95) / 2.05;
      return { y: 0.2 + 0.3 * f, le: -5.4 + 1.1 * f, te: -3.8 + 0.05 * f, t: 0.12 - 0.08 * f };
    };
    const canardR = K.allMoving(group, cAt, [0.95, 3.0], -4.3, 1, skin, 'canardR');
    const canardL = K.allMoving(group, cAt, [0.95, 3.0], -4.3, -1, skin, 'canardL');

    // Cranked (lambda) wing: 45 deg LE, forward-swept inner TE, swept-back outer TE.
    const wAt = (x) => ({
      y: 0.1 - (x - 1.2) * 0.02,
      le: -1.6 + (x - 1.2),
      te: x <= 3.8 ? 6.4 + (x - 1.2) * (3.7 - 6.4) / 2.6 : 3.7 + (x - 3.8) * (0.9 / 2.7),
      t: Math.max(0.06, 0.5 - (x - 1.2) * 0.08),
    });
    const WL = [
      { xs: [1.2, 1.6] },
      { xs: [1.6, 3.6], cut: 0.7, name: 'elev' },
      { xs: [3.6, 3.8, 4.0] },
      { xs: [4.0, 6.2], cut: 0.5, name: 'ail' },
      { xs: [6.2, 6.5] },
    ];
    const wr = K.wing(group, wAt, 1, WL, skin, panel);
    const wl = K.wing(group, wAt, -1, WL, skin, panel);

    // Buried flat nozzles under a chevron-edged shield plate (no vertical tails).
    const nozGeo = K.keepG(new T.BoxGeometry(1.1, 0.3, 0.7));
    const hotGeo = K.keepG(new T.PlaneGeometry(0.98, 0.22));
    const hotMat = K.basic(0x5a2208);
    const burners = [-1, 1].map((s) => {
      const n = K.add(group, nozGeo, metal, 'nozzle');
      n.position.set(0.68 * s, 0.12, 8.7);
      const h = K.add(group, hotGeo, hotMat, 'nozzle-hot');
      h.position.set(0.68 * s, 0.12, 9.06);
      return K.burner(group, [0.68 * s, 0.12, 9.06], 0.9, 0.4, 2.8);
    });
    const sh = new T.Shape();
    [[-1.35, 8.3], [1.35, 8.3], [1.15, 9.35], [0, 9.1], [-1.15, 9.35]].forEach((p, i) => {
      if (i === 0) sh.moveTo(p[0], -p[1]); else sh.lineTo(p[0], -p[1]);
    });
    sh.closePath();
    const shield = K.keepG(new T.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false }));
    shield.rotateX(-Math.PI / 2);
    shield.translate(0, 0.28, 0);
    K.add(group, shield, panel, 'nozzle-shield');

    const L = K.lights(group, [-6.53, 0.0, 3.9], [6.53, 0.0, 3.9], [0, 0.87, 1.5]);

    return {
      group,
      burner: burners[0],
      burners,
      tips: [new T.Vector3(-6.5, 0.0, 4.15), new T.Vector3(6.5, 0.0, 4.15)],
      eye: new T.Vector3(0, 0.8, -6.2),
      strobe: L.strobe,
      navL: L.navL,
      navR: L.navR,
      parts: {
        canardL, canardR, elevL: wl.elevL, elevR: wr.elevR, ailL: wl.ailL, ailR: wr.ailR,
      },
      dispose: K.dispose,
    };
  }

  window.FlightParts = window.FlightParts || {};
  window.FlightParts.planes = {
    f35: { name: 'F-35A Lightning II', note: '', build: (T) => buildF35(T) },
    f47: { name: 'F-47', note: 'Concept based only on the public USAF render', build: (T) => buildF47(T) },
  };
})();
