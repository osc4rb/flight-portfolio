/* physics.js — the physical layer of the flight portfolio (Rapier 0.14 compat, loaded with Three after "Fly in").
   - Terrain: one heightfield collider on exactly the render mesh's grid, so wreckage rests where the ground is drawn.
   - Props at the airbase you can knock over: crate pyramids, a set of drums at the runway end, a cone line.
   - The jet is a kinematic body (fuselage + wing + gear boxes) that shoves props; poses are interpolated per substep.
   - Crash: the jet becomes a tumbling dynamic wreck that sheds debris, burns, and smokes for a minute.
   - fx: a small CPU particle system (fire, sparks, smoke, dust, spray, tyre smoke, feathers), also used by nature.js.
   Registers FlightParts.physics(T, R, opts). T = Three namespace, R = Rapier (init() already awaited). */
(function () {
  'use strict';
  const FP = window.FlightParts = window.FlightParts || {};
  const rand = (a, b) => a + Math.random() * (b - a);

  // =================================================================== particles
  function Particles(T, scene, max, additive) {
    const pos = new Float32Array(max * 3), col = new Float32Array(max * 4), size = new Float32Array(max);
    const g = new T.BufferGeometry();
    const aP = new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage), aC = new T.BufferAttribute(col, 4).setUsage(T.DynamicDrawUsage), aS = new T.BufferAttribute(size, 1).setUsage(T.DynamicDrawUsage);
    g.setAttribute('position', aP); g.setAttribute('aColor', aC); g.setAttribute('aSize', aS);
    const mat = new T.ShaderMaterial({
      uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { uScale: { value: 600 } }]), fog: true, transparent: true, depthWrite: false,
      blending: additive ? T.AdditiveBlending : T.NormalBlending,
      vertexShader: 'attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC;\n#include <fog_pars_vertex>\nvoid main(){ vC = aColor; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);\n gl_PointSize = aSize > 0.0 ? clamp(aSize * uScale / max(0.5, -mvPosition.z), 1.0, 160.0) : 0.0; gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}',
      fragmentShader: 'varying vec4 vC;\n#include <fog_pars_fragment>\nvoid main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0 || vC.a < 0.004) discard;\n gl_FragColor = vec4(vC.rgb, vC.a * (1.0 - r * r));\n#include <colorspace_fragment>\n#include <fog_fragment>\n}',
    });
    const pts = new T.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = additive ? 4 : 3; scene.add(pts);
    const S = { p: new Float32Array(max * 3), v: new Float32Array(max * 3), life: new Float32Array(max), tot: new Float32Array(max), s0: new Float32Array(max), s1: new Float32Array(max),
      c0: new Float32Array(max * 4), c1: new Float32Array(max * 4), drag: new Float32Array(max), grav: new Float32Array(max) };
    let head = 0, alive = 0;
    return {
      mat,
      emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, drag, grav) {
        const i = head; head = (head + 1) % max; if (S.life[i] <= 0) alive++;
        S.p[i * 3] = x; S.p[i * 3 + 1] = y; S.p[i * 3 + 2] = z; S.v[i * 3] = vx; S.v[i * 3 + 1] = vy; S.v[i * 3 + 2] = vz;
        S.life[i] = S.tot[i] = life; S.s0[i] = s0; S.s1[i] = s1; S.drag[i] = drag; S.grav[i] = grav;
        for (let k = 0; k < 4; k++) { S.c0[i * 4 + k] = c0[k]; S.c1[i * 4 + k] = c1[k]; }
      },
      update(dt) {
        if (!alive) return; alive = 0;
        for (let i = 0; i < max; i++) {
          if (S.life[i] <= 0) continue;
          S.life[i] -= dt; if (S.life[i] <= 0) { size[i] = 0; col[i * 4 + 3] = 0; continue; }
          alive++;
          const f = Math.max(0, 1 - S.drag[i] * dt), o = i * 3;
          S.v[o] *= f; S.v[o + 1] = S.v[o + 1] * f - S.grav[i] * dt; S.v[o + 2] *= f;
          S.p[o] += S.v[o] * dt; S.p[o + 1] += S.v[o + 1] * dt; S.p[o + 2] += S.v[o + 2] * dt;
          pos[o] = S.p[o]; pos[o + 1] = S.p[o + 1]; pos[o + 2] = S.p[o + 2];
          const k = 1 - S.life[i] / S.tot[i]; size[i] = S.s0[i] + (S.s1[i] - S.s0[i]) * k;
          for (let c = 0; c < 4; c++) col[i * 4 + c] = S.c0[i * 4 + c] + (S.c1[i * 4 + c] - S.c0[i * 4 + c]) * k;
        }
        aP.needsUpdate = aC.needsUpdate = aS.needsUpdate = true;
      },
    };
  }

  function makeFx(T, scene, hi) {
    const lin = (hex, a) => { const c = new T.Color(hex); return [c.r, c.g, c.b, a]; };
    const add = Particles(T, scene, hi ? 900 : 500, true), norm = Particles(T, scene, hi ? 1600 : 800, false);
    const C = {
      fire0: lin('#ffd27a', 1), fire1: lin('#ff3c12', 0), spark0: lin('#fff2b0', 1), spark1: lin('#ff7a1a', 0),
      smoke0: lin('#3a3836', 0.55), smoke1: lin('#6d6a66', 0), dust0: lin('#b59d74', 0.5), dust1: lin('#cbb994', 0),
      spray0: lin('#ffffff', 0.75), spray1: lin('#d9eef7', 0), tyre0: lin('#e9e7e2', 0.6), tyre1: lin('#ffffff', 0), feather0: lin('#ffffff', 1), feather1: lin('#e8e4dc', 0),
      wash0: lin('#ffffff', 0.25), wash1: lin('#ffffff', 0),
    };
    const sph = (s) => { const u = rand(-1, 1), a = rand(0, Math.PI * 2), r = Math.sqrt(1 - u * u); return [Math.cos(a) * r * s, u * s, Math.sin(a) * r * s]; };
    const fx = {
      add, norm, setScale(s) { add.mat.uniforms.uScale.value = norm.mat.uniforms.uScale.value = s; },
      update(dt) { add.update(dt); norm.update(dt); },
      fire(x, y, z, n, vx, vy, vz, big) { for (let i = 0; i < n; i++) { const d = sph(big ? 22 : 8); add.emit(x, y, z, (vx || 0) + d[0], (vy || 0) + Math.abs(d[1]) + 4, (vz || 0) + d[2], rand(0.5, 1.2), big ? 5 : 2.5, big ? 14 : 7, C.fire0, C.fire1, 1.6, -3); } },
      sparks(x, y, z, n, vx, vy, vz) { for (let i = 0; i < n; i++) { const d = sph(35); add.emit(x, y, z, (vx || 0) + d[0], (vy || 0) + Math.abs(d[1]), (vz || 0) + d[2], rand(0.4, 1.0), 0.9, 0.3, C.spark0, C.spark1, 0.6, 9.81); } },
      smoke(x, y, z, n, big) { for (let i = 0; i < n; i++) { const d = sph(3); norm.emit(x + d[0], y + d[1], z + d[2], d[0] + 1.5, rand(3, 7), d[2] + 0.8, rand(3, 5.5), big ? 9 : 4, big ? 38 : 16, C.smoke0, C.smoke1, 0.35, -0.6); } },
      dust(x, y, z, n, vx, vz) { for (let i = 0; i < n; i++) { const d = sph(6); norm.emit(x + d[0], y + 0.5, z + d[2], (vx || 0) * 0.2 + d[0], rand(1, 4), (vz || 0) * 0.2 + d[2], rand(1, 2), 2, 9, C.dust0, C.dust1, 1.2, 0.5); } },
      spray(x, y, z, n, vx, vz, up) { for (let i = 0; i < n; i++) { const d = sph(5); norm.emit(x + d[0], y + 0.3, z + d[2], (vx || 0) * 0.25 + d[0], rand(4, 9) * (up || 1), (vz || 0) * 0.25 + d[2], rand(0.8, 1.4), 1.5, 6, C.spray0, C.spray1, 0.8, 9.81); } },
      tyre(x, y, z, n) { for (let i = 0; i < n; i++) { const d = sph(1.5); norm.emit(x + d[0], y + 0.4, z + d[2], d[0], rand(0.5, 2), d[2], rand(1, 1.8), 1, 7, C.tyre0, C.tyre1, 1.5, -0.3); } },
      feathers(x, y, z, n) { for (let i = 0; i < n; i++) { const d = sph(6); norm.emit(x, y, z, d[0], d[1] + 2, d[2], rand(1.2, 2.2), 0.6, 0.4, C.feather0, C.feather1, 2.2, 1.5); } },
      wash(x, y, z, n, s) { for (let i = 0; i < n; i++) { const d = sph(s); norm.emit(x + d[0], y + 0.4, z + d[2], d[0] * 1.5, rand(0.5, 2), d[2] * 1.5, rand(0.6, 1.1), 2, 8, C.wash0, C.wash1, 1.2, 0); } },
    };
    return fx;
  }

  // =================================================================== the physics world
  FP.physics = function (T, R, o) {
    // o: { scene, height(x,z), seg, ext, base: {x, y, z} (runway centre, world), hi, onHit(n, speed) }
    const scene = o.scene, hi = !!o.hi, fx = makeFx(T, scene, hi);
    const world = new R.World({ x: 0, y: -9.81, z: 0 }), events = new R.EventQueue(true), H = 1 / 60;
    world.timestep = H;

    // terrain heightfield: rows run along z, columns along x, column-major, same grid as the PlaneGeometry
    const N = o.seg, E = o.ext, hts = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) hts[i + j * (N + 1)] = o.height(-E + 2 * E * j / N, -E + 2 * E * i / N);
    world.createCollider(R.ColliderDesc.heightfield(N, N, hts, { x: 2 * E, y: 1, z: 2 * E }).setFriction(0.9).setRestitution(0.1));

    const q = new T.Quaternion(), e = new T.Euler(), m4 = new T.Matrix4(), v = new T.Vector3(), s3 = new T.Vector3(1, 1, 1);
    const toQ = r => ({ x: r.x, y: r.y, z: r.z, w: r.w });

    // ---------------- props
    const KINDS = {
      crate: { geo: new T.BoxGeometry(2, 2, 2), color: '#b07a3e', col: () => R.ColliderDesc.cuboid(1, 1, 1), dens: 0.22, h: 1 },
      drum:  { geo: new T.CylinderGeometry(0.6, 0.6, 1.8, 12), color: '#d9533f', col: () => R.ColliderDesc.cylinder(0.9, 0.6), dens: 0.3, h: 0.9 },
      cone:  { geo: new T.ConeGeometry(0.42, 1.05, 10), color: '#ff7a1a', col: () => R.ColliderDesc.cone(0.525, 0.42), dens: 0.25, h: 0.525 },
    };
    const B = o.base, place = { crate: [], drum: [], cone: [] };
    const pyramid = (lx, lz, rot) => { const c = Math.cos(rot), s = Math.sin(rot);
      for (let row = 0; row < 4; row++) for (let k = 0; k < 4 - row; k++) { const a = (k - (3 - row) / 2) * 2.08; place.crate.push([lx + a * c, row * 2.0, lz + a * s, rot + rand(-0.05, 0.05)]); } };
    pyramid(52, 1170, 0); pyramid(52, 1120, 0.1); pyramid(165, -300, Math.PI / 2);     // two beside your start, one on the apron
    for (let r = 0; r < 4; r++) for (let k = 0; k <= r; k++) place.drum.push([(k - r / 2) * 1.6, 0, -1345 - r * 1.4, 0]);   // "pins" in the runway overrun
    for (let z = 1180; z > 150; z -= 95) { place.cone.push([-27, 0, z, 0]); place.cone.push([27, 0, z, 0]); }                // runway edge line
    for (let k = 0; k < 10; k++) place.cone.push([110 + (k % 2 ? 4 : -4), 0, 1000 - k * 45, 0]);                              // taxiway slalom

    const props = [];
    Object.keys(KINDS).forEach(kind => {
      const K = KINDS[kind], list = place[kind]; if (!list.length) return;
      const mesh = new T.InstancedMesh(K.geo, new T.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), list.length);
      const c = new T.Color();
      list.forEach((p, i) => {
        const x = B.x + p[0], z = B.z + p[2], y = o.height(x, z) + 0.16 + K.h + p[1];
        const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setRotation(toQ(q.setFromEuler(e.set(0, p[3], 0)))).setCanSleep(true).setLinearDamping(0.05).setAngularDamping(0.15));
        world.createCollider(K.col().setDensity(K.dens).setFriction(0.7).setRestitution(0.25), body);
        body.sleep();
        mesh.setColorAt(i, c.set(K.color).offsetHSL(rand(-0.015, 0.015), 0, rand(-0.06, 0.06)));
        props.push({ body, mesh, i, home: [x, y, z, p[3]], wet: false });
      });
      mesh.castShadow = false; scene.add(mesh); KINDS[kind].mesh = mesh;
    });
    const syncProp = p => { const t = p.body.translation(), r = p.body.rotation(); m4.compose(v.set(t.x, t.y, t.z), q.set(r.x, r.y, r.z, r.w), s3); p.mesh.setMatrixAt(p.i, m4); p.mesh.instanceMatrix.needsUpdate = true; };
    props.forEach(syncProp);

    // ---------------- the jet (kinematic)
    const jet = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -500, 0));
    let jetCols = [], gearCol = null, jetHandleSet = new Set();
    function setJet(len, span, gearH) {
      jetCols.forEach(c => world.removeCollider(c, false)); jetCols = []; jetHandleSet = new Set();
      const mk = (d) => { const c = world.createCollider(d.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS).setDensity(50), jet); jetCols.push(c); jetHandleSet.add(c.handle); return c; };
      mk(R.ColliderDesc.cuboid(0.9, 0.9, len / 2));
      mk(R.ColliderDesc.cuboid(span / 2, 0.3, len * 0.16).setTranslation(0, 0, len * 0.14));
      gearCol = mk(R.ColliderDesc.cuboid(span * 0.16, gearH / 2, len * 0.3).setTranslation(0, -gearH / 2, 0));
    }
    const prev = { p: new T.Vector3(0, -500, 0), q: new T.Quaternion() }, ip = new T.Vector3(), iq = new T.Quaternion();
    let acc = 0, first = true;

    // ---------------- wreck + debris
    let wreck = null;
    const shardGeo = new T.BoxGeometry(1, 1, 1);
    function clearWreck() {
      if (!wreck) return;
      scene.remove(wreck.group); scene.remove(wreck.shards); wreck.shards.material.dispose();
      world.removeRigidBody(wreck.body); wreck.parts.forEach(s => world.removeRigidBody(s.body)); wreck = null;
    }
    function crash(group, vel, onWater) {
      clearWreck(); jetCols.forEach(c => c.setEnabled(false));   // the jet's own boxes must not shove its wreck
      const g = group.clone(true); g.visible = true;
      g.traverse(c => { if (c.material && (c.material.blending === T.AdditiveBlending || c.material.transparent)) c.visible = false; });
      scene.add(g);
      const p = group.position, r = group.quaternion, box = new T.Box3().setFromObject(group), sz = box.getSize(new T.Vector3());
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y + 1.5, p.z).setRotation(toQ(r)).setCcdEnabled(true).setLinearDamping(onWater ? 2.5 : 0.12).setAngularDamping(0.25));
      const WG = (0x0002 << 16) | 0xfffb, SG = (0x0004 << 16) | 0xfffd;   // wreck and its shards ignore each other
      world.createCollider(R.ColliderDesc.cuboid(0.9, 0.8, Math.max(sz.z, 8) / 2).setDensity(0.6).setFriction(0.55).setRestitution(0.2).setCollisionGroups(WG), body);
      world.createCollider(R.ColliderDesc.cuboid(Math.max(sz.x, 6) * 0.42, 0.25, sz.z * 0.15).setTranslation(0, 0, sz.z * 0.14).setDensity(0.6).setFriction(0.55).setCollisionGroups(WG), body);
      const k = onWater ? 0.25 : 0.55;
      body.setLinvel({ x: vel.x * k, y: Math.abs(vel.y) * 0.25 + 6, z: vel.z * k }, true);
      body.setAngvel({ x: rand(-2.5, 2.5), y: rand(-1.5, 1.5), z: rand(-4, 4) }, true);
      // debris shards, painted like the jet
      const NS = hi ? 30 : 18, shards = new T.InstancedMesh(shardGeo, new T.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), NS), parts = [], c = new T.Color();
      const PAINT = ['#7f868e', '#5b6168', '#2b2f35', '#9aa1a8', '#1d1f23', '#c9ccd0'];
      for (let i = 0; i < NS; i++) {
        const sx = rand(0.25, 1.8), sy = rand(0.08, 0.5), sz2 = rand(0.25, 1.6), d = [rand(-3, 3), rand(0, 1.5), rand(-sz.z / 2, sz.z / 2)];
        const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.x + d[0], p.y + 1.5 + d[1], p.z + d[2]).setCcdEnabled(i < 8).setLinearDamping(onWater ? 3 : 0.2).setAngularDamping(0.3));
        world.createCollider(R.ColliderDesc.cuboid(sx / 2, sy / 2, sz2 / 2).setDensity(0.4).setFriction(0.6).setRestitution(0.3).setCollisionGroups(SG), b);
        b.setLinvel({ x: vel.x * k * rand(0.6, 1.1) + rand(-22, 22), y: rand(6, 26), z: vel.z * k * rand(0.6, 1.1) + rand(-22, 22) }, true);
        b.setAngvel({ x: rand(-12, 12), y: rand(-12, 12), z: rand(-12, 12) }, true);
        shards.setColorAt(i, c.set(PAINT[i % PAINT.length])); parts.push({ body: b, s: new T.Vector3(sx, sy, sz2) });
      }
      shards.frustumCulled = false; scene.add(shards);
      wreck = { group: g, body, shards, parts, t: 0, water: onWater };
      if (onWater) { fx.spray(p.x, 0, p.z, 90, vel.x, vel.z, 2.4); fx.spray(p.x, 0, p.z, 40, 0, 0, 3.5); }
      else { fx.fire(p.x, p.y, p.z, hi ? 70 : 40, vel.x * 0.2, 0, vel.z * 0.2, true); fx.sparks(p.x, p.y, p.z, 50, vel.x * 0.3, 0, vel.z * 0.3); fx.smoke(p.x, p.y, p.z, 20, true); fx.dust(p.x, p.y, p.z, 30, vel.x, vel.z); }
    }

    // ---------------- step
    let hitCool = 0;
    function step(dt, J) {
      // J: { pos, quat, gear (bool), teleport (bool) }
      fx.update(dt); hitCool -= dt;
      if (gearCol && gearCol.isEnabled() !== !!J.gear && jetCols[0] && jetCols[0].isEnabled()) gearCol.setEnabled(!!J.gear);
      if (J.teleport || first) { jetCols.forEach(c => c.setEnabled(true)); jet.setTranslation(J.pos, true); jet.setRotation(toQ(J.quat), true); prev.p.copy(J.pos); prev.q.copy(J.quat); first = false; }
      // skip the solver when nothing can move: no wreck, every prop asleep, jet far from the airbase
      const near = Math.hypot(J.pos.x - B.x, J.pos.z - B.z) < 1700 && J.pos.y - B.y < 60;
      const awake = props.some(p => !p.body.isSleeping());
      if (!wreck && !awake && !near) { prev.p.copy(J.pos); prev.q.copy(J.quat); jet.setTranslation(J.pos, false); acc = 0; return; }
      acc = Math.min(acc + dt, H * 4);
      const n = Math.floor(acc / H); if (!n) return;
      let hits = 0, hitSpeed = 0;
      for (let s = 1; s <= n; s++) {
        const t = s / n; ip.lerpVectors(prev.p, J.pos, t); iq.slerpQuaternions(prev.q, J.quat, t);
        jet.setNextKinematicTranslation(ip); jet.setNextKinematicRotation(toQ(iq));
        world.step(events);
        events.drainCollisionEvents((h1, h2, started) => { if (started && (jetHandleSet.has(h1) || jetHandleSet.has(h2))) hits++; });
      }
      acc -= n * H; prev.p.copy(J.pos); prev.q.copy(J.quat);
      // keep shoved props sane, splash the ones that reach the sea, sync meshes
      for (const p of props) {
        if (p.body.isSleeping()) continue;
        const lv = p.body.linvel(), sp = Math.hypot(lv.x, lv.y, lv.z);
        if (sp > 70) p.body.setLinvel({ x: lv.x * 70 / sp, y: lv.y * 70 / sp, z: lv.z * 70 / sp }, true);
        if (sp > hitSpeed) hitSpeed = sp;
        const t = p.body.translation();
        if (!p.wet && t.y < 0.5) { p.wet = true; p.body.setLinearDamping(3); p.body.setAngularDamping(2); fx.spray(t.x, 0, t.z, 14, lv.x, lv.z); }
        syncProp(p);
      }
      if (hits && hitCool <= 0 && o.onHit) { hitCool = 0.25; o.onHit(hits, hitSpeed); }
      // wreck
      if (wreck) {
        wreck.t += dt;
        const t = wreck.body.translation(), r = wreck.body.rotation();
        wreck.group.position.set(t.x, t.y, t.z); wreck.group.quaternion.set(r.x, r.y, r.z, r.w);
        if (!wreck.water && t.y < 0.3) { wreck.water = true; wreck.body.setLinearDamping(2.5); fx.spray(t.x, 0, t.z, 60, 0, 0, 2); }
        wreck.parts.forEach((pp, i) => { const a = pp.body.translation(), b = pp.body.rotation(); m4.compose(v.set(a.x, a.y, a.z), q.set(b.x, b.y, b.z, b.w), pp.s); wreck.shards.setMatrixAt(i, m4);
          if (a.y < 0.2 && !pp.wet) { pp.wet = true; pp.body.setLinearDamping(3); fx.spray(a.x, 0, a.z, 5, 0, 0); } });
        wreck.shards.instanceMatrix.needsUpdate = true;
        if (!wreck.water) {                                              // it burns, then smoulders
          if (wreck.t < 9 && Math.random() < dt * 22) fx.fire(t.x, t.y + 0.5, t.z, 1, 0, 2, 0, false);
          if (wreck.t < 70 && Math.random() < dt * (wreck.t < 9 ? 10 : 3)) fx.smoke(t.x, t.y + 1, t.z, 1, wreck.t > 4);
        }
        if (wreck.t > 90) clearWreck();
      }
    }

    function resetProps() {
      props.forEach(p => { const h = p.home; p.body.setTranslation({ x: h[0], y: h[1], z: h[2] }, false); p.body.setRotation(toQ(q.setFromEuler(e.set(0, h[3], 0))), false);
        p.body.setLinvel({ x: 0, y: 0, z: 0 }, false); p.body.setAngvel({ x: 0, y: 0, z: 0 }, false); p.body.setLinearDamping(0.05); p.body.setAngularDamping(0.15); p.wet = false; p.body.sleep(); syncProp(p); });
    }
    const groundAt = (x, z) => { const ray = new R.Ray({ x, y: 3000, z }, { x: 0, y: -1, z: 0 }), hit = world.castRay(ray, 5000, true); return hit ? 3000 - (hit.timeOfImpact != null ? hit.timeOfImpact : hit.toi) : null; };

    return {
      fx, setJet, step, crash, clearWreck, resetProps, groundAt,
      wreckPos: () => wreck ? wreck.group.position : null,
      wreckVel: () => { if (!wreck) return null; const l = wreck.body.linvel(); return v.set(l.x, l.y, l.z); },
      moved: () => props.filter(p => { const t = p.body.translation(); return Math.hypot(t.x - p.home[0], t.z - p.home[2]) > 3; }).length,
      count: props.length,
    };
  };
})();
