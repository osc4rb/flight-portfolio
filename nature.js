/* nature.js — the living layer of the island.
   - Grass: instanced tufts in 600 m cells (frustum + distance culled) around the airbase, the landmarks and a few
     meadows. A vertex shader bends them with two octaves of travelling wind, and the jet's wash flattens and
     pushes them outward on a low pass or when the engine runs on the ground.
   - Trees: the existing instanced trees get the same wind (gentler) and wash, by patching their material.
   - Birds: flocks circle the landmarks; they scatter when the jet comes close, and a strike leaves feathers.
   - Water: a moving shimmer on the sea, spray when you skim it, dust and grass wash when you skim land.
   Registers FlightParts.nature(T, opts). Uses the fx particles from physics.js when present. */
(function () {
  'use strict';
  const FP = window.FlightParts = window.FlightParts || {};
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // shared GLSL: world-space wind + jet wash applied after the instance transform
  const WIND_PARS = 'uniform float uTime; uniform vec2 uWind; uniform float uGust; uniform vec3 uJet; uniform float uWash; uniform float uWashR; uniform float uAmp;\n';
  const WIND_PROJECT = (heightExpr) => `
    vec4 wp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
    #endif
    wp = modelMatrix * wp;
    float bend = ${heightExpr};
    float wave = sin(dot(wp.xz, uWind) * 0.07 - uTime * 2.1) * 0.55 + sin(dot(wp.xz, vec2(0.62, -0.78)) * 0.21 - uTime * 3.3) * 0.25 + 0.45;
    wp.xz += uWind * wave * uGust * uAmp * bend;
    vec2 dj = wp.xz - uJet.xz; float dl = length(dj);
    float w = uWash * (1.0 - smoothstep(uWashR * 0.25, uWashR, dl)) * clamp(1.0 - (uJet.y - wp.y) / 45.0, 0.0, 1.0);
    w *= 0.75 + 0.25 * sin(uTime * 23.0 + dl * 0.6);
    wp.xz += (dj / max(dl, 0.001)) * w * bend * uAmp * 2.4; wp.y -= w * bend * uAmp * 0.9;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;`;

  function patchWind(mat, U, heightExpr, upNormal) {
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = WIND_PARS + sh.vertexShader.replace('#include <project_vertex>', WIND_PROJECT(heightExpr));
      // blades are lit like the ground on both faces (no dark backs)
      if (upNormal) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>' + String.fromCharCode(10) + ' normal = normalize(vNormal);');
    };
    mat.customProgramCacheKey = () => 'wind-' + heightExpr;
  }

  function tuftGeometry(T) {
    // three crossed blades, 3 segments each; y runs 0..1 so the shader can use it as the bend weight
    const P = [], C = [], I = [], base = [0.23, 0.36, 0.15], tip = [0.62, 0.74, 0.35];
    for (let b = 0; b < 3; b++) {
      const a = b * Math.PI / 3 + 0.3, ca = Math.cos(a), sa = Math.sin(a), start = P.length / 3, lean = (b - 1) * 0.12;
      for (let s = 0; s <= 3; s++) {
        const y = s / 3, w = 0.5 * (1 - y * 0.92), off = lean * y * y;
        P.push(-ca * w + off, y, -sa * w, ca * w + off, y, sa * w);
        const k = y; for (let n = 0; n < 2; n++) C.push(base[0] + (tip[0] - base[0]) * k, base[1] + (tip[1] - base[1]) * k, base[2] + (tip[2] - base[2]) * k);
      }
      for (let s = 0; s < 3; s++) { const i = start + s * 2; I.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setAttribute('color', new T.Float32BufferAttribute(C, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(P.map((_, i) => i % 3 === 1 ? 1 : 0), 3)); g.setIndex(I);
    return g;
  }

  function birdGeometry(T) {
    // body sliver + two wings; forward is -z. |x| is the flap weight
    const P = [0, 0, -0.9, -0.16, 0, 0.6, 0.16, 0, 0.6,
      -0.1, 0, -0.35, -1.6, 0.05, 0.15, -0.1, 0, 0.35,
      0.1, 0, -0.35, 0.1, 0, 0.35, 1.6, 0.05, 0.15];
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
  }

  FP.nature = function (T, o) {
    // o: { scene, height(x,z), spots: [[x,z],...], flat: FLAT, rIsl, hi, trees, water, fx, rng(seed) }
    const scene = o.scene, hi = !!o.hi, R = o.rng(23), fx = o.fx;
    const U = { uTime: { value: 0 }, uWind: { value: new T.Vector2(0.8, 0.6) }, uGust: { value: 1 }, uJet: { value: new T.Vector3(0, -999, 0) }, uWash: { value: 0 }, uWashR: { value: 40 }, uAmp: { value: 0.35 } };
    const UT = Object.assign({}, U, { uAmp: { value: 0.05 } });       // trees: same clock, same jet, gentler

    // ---------------- grass
    const CELL = 600, cells = new Map();
    const slope = (x, z, h) => Math.abs(h - o.height(x + 20, z)) + Math.abs(h - o.height(x, z + 20));
    const paved = (x, z) => (Math.abs(x) < 34 && z > 150 && z < 2850) || (x > 90 && x < 132 && z > 330 && z < 2670) ||
      (x > 20 && x < 132 && (Math.abs(z - 600) < 16 || Math.abs(z - 2400) < 16)) || (x > 115 && x < 312 && z > 1060 && z < 1340) || (x > 150 && x < 236 && z > 1380 && z < 1450);
    function addTuft(x, z, kind) {
      const h = o.height(x, z); if (h < 6 || h > 420 || slope(x, z, h) > 14 || paved(x, z)) return false;
      const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL); let c = cells.get(key); if (!c) cells.set(key, c = []);
      c.push([x, h, z, kind]); return true;
    }
    const want = hi ? 1 : 0.4;
    // the airbase: dense meadow around the runway, thinner further out
    for (let i = 0, made = 0, n = 26000 * want; i < n * 4 && made < n; i++) { const x = (R() * 2 - 1) * 650, z = -150 + R() * 3300, d = Math.abs(x) / 650; if (R() < d * 0.6) continue; if (addTuft(x, z, R() < 0.04 ? 1 : 0)) made++; }
    // around each landmark, kept off the structure itself
    (o.spots || []).forEach(([sx, sz]) => { for (let i = 0, n = 5000 * want; i < n; i++) { const a = R() * Math.PI * 2, r = 70 + Math.sqrt(R()) * 520; addTuft(sx + Math.cos(a) * r, sz + Math.sin(a) * r, R() < 0.05 ? 1 : 0); } });
    // a few open meadows
    for (let m = 0, made = 0; m < 400 && made < 14; m++) {
      const cx = (R() * 2 - 1) * o.rIsl * 0.8, cz = (R() * 2 - 1) * o.rIsl * 0.8, h = o.height(cx, cz); if (h < 20 || h > 300 || slope(cx, cz, h) > 8) continue; made++;
      for (let i = 0, n = 1600 * want; i < n; i++) { const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 260; addTuft(cx + Math.cos(a) * r, cz + Math.sin(a) * r, R() < 0.06 ? 1 : 0); }
    }
    const tuft = tuftGeometry(T), gMat = new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide });
    patchWind(gMat, U, 'position.y * position.y', true);
    const grass = [], dummy = new T.Object3D(), col = new T.Color(), FLOWER = [[1.5, 1.1, 0.3], [1.5, 1.3, 2.6], [1.5, 0.6, 1.4], [0.9, 0.75, 2.4]];   // linear multipliers on the blade colours
    let tufts = 0;
    cells.forEach(list => {
      const im = new T.InstancedMesh(tuft, gMat, list.length);
      list.forEach((t, i) => {
        const s = 1.3 + R() * 1.4; dummy.position.set(t[0], t[1] - 0.1, t[2]); dummy.rotation.set(0, R() * 6.28, 0); dummy.scale.set(s * (1.1 + R() * 0.8), s, s * (1.1 + R() * 0.8)); dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        const j = 0.82 + R() * 0.36, fl = FLOWER[(R() * FLOWER.length) | 0];
        im.setColorAt(i, t[3] ? col.setRGB(fl[0], fl[1], fl[2]) : col.setRGB(0.55 * j * (0.9 + R() * 0.25), 0.72 * j, 0.42 * j * (0.85 + R() * 0.3)));
      });
      im.computeBoundingSphere(); im.userData.c = im.boundingSphere.center.clone(); scene.add(im); grass.push(im); tufts += list.length;
    });

    // ---------------- trees sway (cone geometry runs 0..1 in y)
    if (o.trees) { patchWind(o.trees.material, UT, 'position.y * position.y'); o.trees.material.needsUpdate = true; }

    // ---------------- water shimmer
    const WU = { uTime: U.uTime };
    if (o.water) {
      const wm = o.water.material;
      wm.onBeforeCompile = sh => {
        sh.uniforms.uTime = WU.uTime;
        sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = 'uniform float uTime; varying vec3 vWp;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float s1 = sin(vWp.x * 0.021 + uTime * 0.55) * sin(vWp.z * 0.026 - uTime * 0.45);
          float s2 = sin((vWp.x * 0.8 + vWp.z) * 0.07 + uTime * 1.4) * sin((vWp.x - vWp.z * 0.6) * 0.09 - uTime * 1.1);
          diffuseColor.rgb *= 0.95 + 0.05 * s1 + 0.04 * s2;
          diffuseColor.rgb += vec3(0.05, 0.07, 0.08) * smoothstep(0.82, 1.0, s2);`);
      };
      wm.customProgramCacheKey = () => 'water-shimmer'; wm.needsUpdate = true;
    }

    // ---------------- birds
    const NF = hi ? 7 : 5, PER = hi ? 12 : 9, NB = NF * PER;
    const bMat = new T.MeshBasicMaterial({ color: '#2b2f35', side: T.DoubleSide });
    bMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = U.uTime;
      sh.vertexShader = 'uniform float uTime; attribute float aPhase; attribute float aFlap;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n float ax = abs(position.x); transformed.y += sin(uTime * aFlap + aPhase) * ax * 0.55; transformed.x *= 1.0 - 0.12 * abs(sin(uTime * aFlap + aPhase));');
    };
    bMat.customProgramCacheKey = () => 'bird-flap';
    const bGeo = birdGeometry(T), phase = new Float32Array(NB), flap = new Float32Array(NB);
    for (let i = 0; i < NB; i++) { phase[i] = R() * 6.28; flap[i] = 9 + R() * 4; }
    bGeo.setAttribute('aPhase', new T.InstancedBufferAttribute(phase, 1)); bGeo.setAttribute('aFlap', new T.InstancedBufferAttribute(flap, 1));
    const birds = new T.InstancedMesh(bGeo, bMat, NB); birds.frustumCulled = false; scene.add(birds);
    const anchors = [[0, 1500], [0, 2900]].concat(o.spots || []);
    const flocks = [];
    for (let f = 0; f < NF; f++) {
      const a = anchors[f % anchors.length], gx = a[0] + (f >= anchors.length ? 600 : 0), gz = a[1];
      const gull = Math.max(o.height(gx, gz), 0) < 40;
      flocks.push({ x: gx, z: gz, alt: Math.max(o.height(gx, gz), 0) + 70 + R() * 90, r: 120 + R() * 120, w: (R() < 0.5 ? -1 : 1) * (0.18 + R() * 0.1), a: R() * 6.28, scare: 0, gull });
    }
    const B = [];
    for (let i = 0; i < NB; i++) {
      const f = flocks[(i / PER) | 0];
      B.push({ f, q: new T.Quaternion(), p: new T.Vector3(f.x + (R() - 0.5) * 60, f.alt, f.z + (R() - 0.5) * 60), v: new T.Vector3(), off: new T.Vector3((R() - 0.5) * 50, (R() - 0.5) * 16, (R() - 0.5) * 50), ph: R() * 6.28, gone: 0 });
      birds.setColorAt(i, col.set(f.gull ? '#f3f1ea' : '#2b2f35'));
    }
    const m4 = new T.Matrix4(), tgt = new T.Vector3(), look = new T.Vector3(), UP = new T.Vector3(0, 1, 0), S0 = new T.Vector3(0.0001, 0.0001, 0.0001), S1 = new T.Vector3(1.7, 1.7, 1.7), qq = new T.Quaternion(), pp = new T.Vector3();
    let strikes = 0;

    // ---------------- per frame
    let sprayAcc = 0;
    function update(dt, time, J, camPos) {
      // J: { pos, vel, v, agl, onGround, thr, ab, fwd, len, water (bool: sea under the jet) }
      U.uTime.value = time; U.uGust.value = 0.65 + 0.35 * Math.sin(time * 0.31) * Math.sin(time * 0.17 + 1);
      const low = clamp(1 - J.agl / 32, 0, 1) * clamp((J.v - 20) / 60, 0, 1), blast = J.onGround ? clamp(J.thr * 0.9 + (J.ab ? 0.6 : 0), 0, 1.3) : 0;
      U.uJet.value.copy(J.pos); U.uWash.value = Math.max(low, blast); U.uWashR.value = J.onGround ? 22 + J.thr * 20 : 30 + J.v * 0.12;
      if (J.onGround) U.uJet.value.addScaledVector(J.fwd, -J.len * 0.9);   // engine blast sits behind the jet on the ground

      // grass cells: only near ones are drawn
      for (const im of grass) im.visible = im.userData.c.distanceToSquared(camPos) < 2300 * 2300;

      // skim effects
      if (fx && J.v > 25) {
        sprayAcc += dt * 60;
        const n = sprayAcc | 0; sprayAcc -= n;
        if (n && low > 0.05) {
          const bx = J.pos.x - J.fwd.x * J.len * 0.6, bz = J.pos.z - J.fwd.z * J.len * 0.6;
          if (J.water) fx.spray(bx, 0, bz, Math.ceil(n * 3 * low), J.vel.x, J.vel.z, 0.6 + low);
          else if (!J.onGround) { if (Math.random() < low) fx.wash(bx, o.height(bx, bz), bz, Math.ceil(n * 2 * low), 6); }
        }
        if (n && J.onGround && J.v > 30 && !paved(J.pos.x, J.pos.z)) fx.dust(J.pos.x, o.height(J.pos.x, J.pos.z), J.pos.z, n, J.vel.x, J.vel.z);
      }

      // birds
      for (const f of flocks) {
        f.a += f.w * dt; f.scare = Math.max(0, f.scare - dt);
        const dx = J.pos.x - f.x, dz = J.pos.z - f.z, dy = J.pos.y - f.alt;
        if (dx * dx + dz * dz + dy * dy < 320 * 320 && J.v > 15) f.scare = 6;
      }
      for (let i = 0; i < NB; i++) {
        const b = B[i], f = b.f;
        if (b.gone > 0) { b.gone -= dt; if (b.gone <= 0) b.p.set(f.x, f.alt + 40, f.z); m4.compose(b.p, qq, S0); birds.setMatrixAt(i, m4); continue; }
        b.ph += dt * 0.7;
        const spread = f.scare > 0 ? 3.2 : 1;
        tgt.set(f.x + Math.cos(f.a) * f.r + b.off.x * spread + Math.cos(b.ph) * 12, f.alt + b.off.y * spread + Math.sin(b.ph * 1.3) * 6, f.z + Math.sin(f.a) * f.r + b.off.z * spread + Math.sin(b.ph) * 12);
        const k = f.scare > 0 ? 0.6 : 0.9;
        b.v.x += (tgt.x - b.p.x) * k * dt; b.v.y += (tgt.y - b.p.y) * k * dt; b.v.z += (tgt.z - b.p.z) * k * dt;
        const jx = b.p.x - J.pos.x, jy = b.p.y - J.pos.y, jz = b.p.z - J.pos.z, jd2 = jx * jx + jy * jy + jz * jz;
        if (jd2 < 200 * 200) { const jd = Math.sqrt(jd2) + 1, push = 2400 / jd; b.v.x += jx / jd * push * dt; b.v.y += (jy / jd * push + 8) * dt; b.v.z += jz / jd * push * dt; }
        if (jd2 < 7 * 7 && J.v > 30) { b.gone = 15; strikes++; if (fx) fx.feathers(b.p.x, b.p.y, b.p.z, 26); continue; }
        b.v.multiplyScalar(1 - Math.min(1, dt * 0.9)); const sp = b.v.length(), mx = f.scare > 0 ? 34 : 20; if (sp > mx) b.v.multiplyScalar(mx / sp);
        b.p.addScaledVector(b.v, dt);
        const gy = Math.max(o.height(b.p.x, b.p.z), 0) + 8; if (b.p.y < gy) { b.p.y = gy; b.v.y = Math.abs(b.v.y); }
        if (sp > 0.5) { m4.lookAt(b.p, look.copy(b.p).add(b.v), UP); b.q.setFromRotationMatrix(m4); }
        m4.compose(b.p, b.q, S1); birds.setMatrixAt(i, m4);
      }
      birds.instanceMatrix.needsUpdate = true;
    }

    return { update, tufts, cells: grass.length, birds: NB, strikes: () => strikes, setWind(x, z) { U.uWind.value.set(x, z).normalize(); } };
  };
})();
