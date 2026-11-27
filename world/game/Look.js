/* Look.js — the island's look, ported from folio-2025 (Bruno Simon, MIT): his Ligthing.js, Fog.js, Cycles and the
   terrain colour node that MeshDefaultMaterial bounces light from. The shading itself is his MeshDefaultMaterial
   (engine/Materials). Every material in the scene is swapped for it, so the whole world shares one model:
   lit colour × light colour, a soft core-shadow edge and drop shadows that blend toward a tinted shadow colour,
   light bounced up from the ground colour, and a screen-space fog gradient that is also the sky.
   The colours (the four presets below) are ours. A full day lasts DAY seconds; ?time=0..1 pins it. */
import * as THREE from 'three/webgpu'
import { uniform, color, float, mix, smoothstep, texture, vec2, vec3, viewportUV, rangeFogFactor, Fn, uv, vertexColor, instancedBufferAttribute, materialOpacity, positionWorld, normalWorld, screenCoordinate, step, fract, sin, dot, time, max, min, floor, hash } from 'three/tsl'
import { Game } from '../engine/Game.js'
import { MeshDefaultMaterial } from '../engine/Materials/MeshDefaultMaterial.js'
import { PALETTE } from './Stage.js'
import { foliageMaterial } from './Foliage.js'

const DAY = 8 * 60
const C = (c) => new THREE.Color(c)
// day, dusk, night, dawn — light, shadow and fog colours, and the opening ring's glow (blue at every hour)
const PRESETS = {
    day:   { revealColor: C('#5f7dff'), revealIntensity: 12, lightColor: C('#fff2e0'), lightIntensity: 1.08, shadowColor: C('#9a8cff'), fogColorA: C('#c8f1ff'), fogColorB: C('#8fb8ff'), fogNearRatio: 0.45, fogFarRatio: 1.6 },
    dusk:  { revealColor: C('#6670ff'), revealIntensity: 8, lightColor: C('#ffa184'), lightIntensity: 1.25, shadowColor: C('#5a249c'), fogColorA: C('#ffb2a6'), fogColorB: C('#7a5cff'), fogNearRatio: 0.1, fogFarRatio: 1.4 },
    night: { revealColor: C('#5a6cff'), revealIntensity: 10, lightColor: C('#7d8ce0'), lightIntensity: 0.85, shadowColor: C('#2b2a6e'), fogColorA: C('#16265c'), fogColorB: C('#2a1642'), fogNearRatio: - 0.2, fogFarRatio: 1.2 },
    dawn:  { revealColor: C('#6b84ff'), revealIntensity: 7, lightColor: C('#ffb38c'), lightIntensity: 1.25, shadowColor: C('#b03a7a'), fogColorA: C('#ffc9a6'), fogColorB: C('#c58cff'), fogNearRatio: 0.3, fogFarRatio: 1.4 },
}
const KEYS = [ [ 'day', 0 ], [ 'day', 0.5 ], [ 'dusk', 0.6 ], [ 'night', 0.7 ], [ 'night', 0.82 ], [ 'dawn', 0.92 ], [ 'day', 1 ] ]

export class Look
{
    constructor()
    {
        this.game = Game.getInstance()
        const g = this.game
        const pinned = /[?&]time=([\d.]+)/.exec(location.search)
        this.pinned = pinned ? parseFloat(pinned[1]) % 1 : null
        this.start = performance.now()
        this.progress = this.pinned ?? 0.08

        // the current values, interpolated from the presets every tick (Cycles)
        this.properties = {}
        for(const k in PRESETS.day) this.properties[k] = { value: PRESETS.day[k] instanceof THREE.Color ? PRESETS.day[k].clone() : PRESETS.day[k] }

        this.nightUniform = uniform(0)              // 0 by day, 1 at night: lamps and windows read it
        this.setLighting()
        this.setFog()
        this.setTerrain()
        g.lighting = this.lighting; g.fog = this.fog; g.terrain = this.terrain
        g.dayCycles = this
        this.cache = new Map()
        this.flying = false

        g.scene.fog = null                         // fog is in the shading now
        g.stage.hemi.intensity = 0
        this.update()
        g.ticker.events.on('tick', () => this.update(), 8.8)
    }

    // ---------------------------------------------------------------- Ligthing.js (direction, colour, shadow colour)
    setLighting()
    {
        const L = this.lighting = {}
        L.phi = 0.63; L.theta = 0.72; L.phiAmplitude = 0.62; L.thetaAmplitude = 1.25
        L.spherical = new THREE.Spherical(1, L.phi, L.theta)
        L.direction = new THREE.Vector3().setFromSpherical(L.spherical).normalize()
        L.directionUniform = uniform(L.direction)
        L.colorUniform = uniform(color('#ffffff'))
        L.intensityUniform = uniform(1)
        L.lightBounceEdgeLow = uniform(float(- 1))
        L.lightBounceEdgeHigh = uniform(float(1))
        L.lightBounceDistance = uniform(float(1.5))
        L.lightBounceMultiplier = uniform(float(1))
        L.shadowColor = uniform(this.properties.shadowColor.value)
        L.coreShadowEdgeLow = uniform(float(- 0.25))
        L.coreShadowEdgeHigh = uniform(float(1))
        // the drop-shadow light is Stage's sun; we only steer it
        const sun = this.game.stage.sun
        sun.shadow.bias = - 0.001; sun.shadow.normalBias = 0.1; sun.shadow.radius = this.game.quality.level === 0 ? 3 : 2
    }

    // ---------------------------------------------------------------- Fog.js (radial screen gradient = sky + fog)
    setFog()
    {
        const F = this.fog = {}
        F.colorA = uniform(color('#ffffff')); F.colorB = uniform(color('#ffffff'))
        F.radialCenter = uniform(vec2(0.5, 0.35)); F.radialStart = uniform(0); F.radialEnd = uniform(0.9)
        F.color = mix(F.colorA, F.colorB, vec2(viewportUV.xy).sub(F.radialCenter).length().smoothstep(F.radialStart, F.radialEnd))
        this.game.scene.background = null
        this.game.scene.backgroundNode = F.color
        F.near = uniform(70); F.far = uniform(190)
        F.strength = rangeFogFactor(F.near, F.far)
    }

    // ---------------------------------------------------------------- Terrain.js colour node (light bounce reads it)
    setTerrain()
    {
        const T = this.terrain = {}, map = this.game.grass.map, TE = 210
        T.grassColorUniform = uniform(color(PALETTE.grass))
        T.sandColorUniform = uniform(color(PALETTE.sand))
        T.terrainNode = Fn(([ position ]) => texture(map, position.div(TE * 2).add(0.5)))
        T.colorNode = Fn(([ data ]) => mix(T.sandColorUniform, T.grassColorUniform, smoothstep(0, 0.3, data.g)))
    }

    // ---------------------------------------------------------------- swap every material for MeshDefaultMaterial
    convert(root = this.game.scene)
    {
        root.traverse(o =>
        {
            if(!o.isMesh || !o.material || o.userData.keepMaterial) return
            if(Array.isArray(o.material)) { o.material = o.material.map(m => this.convertMaterial(m, o)); return }
            o.material = this.convertMaterial(o.material, o)
        })
    }

    convertMaterial(m, mesh)
    {
        if(m.isMeshDefault || m.isMeshBasicMaterial || m.isMeshBasicNodeMaterial || m.isSpriteMaterial || m.isLineBasicMaterial || m.isPointsMaterial) return m
        if(!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertNodeMaterial)) return m
        if(m.positionNode) return m                                                 // custom vertex shaders (grass) are built by hand
        if(m.userData.foliage) { const k = 'foliage:' + mesh.uuid; if(!this.cache.has(k)) this.cache.set(k, foliageMaterial(this, mesh, MeshDefaultMaterial)); return this.cache.get(k) }
        const inst = mesh.isInstancedMesh && mesh.instanceColor
        const key = m.uuid + (inst ? ':' + mesh.uuid : '') + (mesh.userData.ground ? ':ground' : '') + (mesh.userData.slabs ? ':slabs' : '') + (mesh.userData.softUp ? ':soft' : '')
        if(this.cache.has(key)) return this.cache.get(key)

        let base = uniform(m.color ? m.color.clone() : new THREE.Color(1, 1, 1))
        if(m.map) base = texture(m.map).rgb.mul(base)
        if(m.vertexColors) base = base.mul(vertexColor().rgb)
        if(inst) base = base.mul(instancedBufferAttribute(mesh.instanceColor).rgb)
        if(mesh.userData.slabs) base = this.slabs(base)
        const out = new MeshDefaultMaterial({
            colorNode: base,
            // houses that hide you dissolve in a screen-door pattern (crisp, keeps colours); others blend as before
            alphaNode: m.userData.fade ? this.holeNode() : m.transparent ? materialOpacity : float(1),
            transparent: m.transparent,
            side: m.side,
            hasLightBounce: !mesh.userData.noBounce && !mesh.userData.ground,
            // big rock (Course.js) leans its normals toward up, so whole mountainsides don't fall into core shadow
            normalNode: mesh.userData.ground ? vec3(0, 1, 0) : mesh.userData.softUp ? mix(normalWorld, vec3(0, 1, 0), float(mesh.userData.softUp)).normalize() : undefined,
        })
        out.isMeshDefault = true
        out.name = m.name; out.opacity = m.opacity; out.map = m.map || null
        out.emissive = new THREE.Color(0, 0, 0); out.emissiveIntensity = 0
        out.flatShading = !!m.flatShading
        out.polygonOffset = m.polygonOffset; out.polygonOffsetFactor = m.polygonOffsetFactor; out.polygonOffsetUnits = m.polygonOffsetUnits
        out.depthWrite = m.depthWrite
        out.userData.ownGlow = true                                                 // Juice glows it in place
        this.cache.set(key, out)
        return out
    }

    // water, after folio-2025's WaterSurface: depth (surface minus the terrain height baked in the grass map) gives
    // the colour and how see-through it is; a foam line hugs the shore and contour ripples roll out from it
    waterMaterial()
    {
        const T = this.terrain, surface = this.game.water.surfaceElevation
        const h = T.terrainNode(positionWorld.xz).r, depth = max(float(surface).sub(h), 0)
        const shallow = color('#5fd3d0'), mid = color('#2a92c2'), deepC = color('#1a4f8f')
        const base = mix(mix(shallow, mid, smoothstep(0.2, 1.6, depth)), deepC, smoothstep(1.6, 4.5, depth))
        const shore = smoothstep(0.16, 0.05, depth)
        const phase = depth.mul(2.6).sub(time.mul(0.25)), wave = fract(phase)
        // each ripple ring is broken into dashes that drift along the shore
        const dashes = sin(positionWorld.x.mul(0.37).add(positionWorld.z.mul(0.29)).add(phase.floor().mul(2.3)).add(time.mul(0.4))).mul(0.5).add(0.5)
        const ripples = smoothstep(0.9, 0.93, wave).mul(smoothstep(0.95, 0.99, wave).oneMinus()).mul(smoothstep(1.5, 0.3, depth)).mul(smoothstep(0.45, 0.7, dashes)).mul(0.8)
        const foam = max(shore, ripples)
        const W = this.water = { foam: uniform(color('#ffffff')) }
        const m = new MeshDefaultMaterial({
            colorNode: mix(base, W.foam, foam),
            alphaNode: max(smoothstep(0.02, 1.4, depth).mul(0.82), foam),
            alphaTest: 0, transparent: true, depthWrite: false,
            hasCoreShadows: false, hasDropShadows: true, hasLightBounce: false,
        })
        m.isMeshDefault = true
        return m
    }

    // stone slabs in staggered rows: darker gaps, each slab a little lighter or darker (paths and the plaza)
    slabs(base)
    {
        const q = positionWorld.xz.div(vec2(1.5, 1.1)), row = floor(q.y)
        const p = vec2(q.x.add(row.mul(0.5)), q.y)
        const cell = floor(p), f = fract(p)
        const edge = min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus()))
        const gap = smoothstep(0.025, 0.06, edge)
        const tint = hash(cell.x.add(cell.y.mul(57.13)).add(311.7)).mul(0.18).add(0.91)
        return mix(base.mul(0.68), base.mul(tint), gap)
    }

    // a house that hides you opens a soft dithered hole around you on screen; the rest of it stays solid
    holeUniforms()
    {
        if(!this.hole) this.hole = { center: uniform(vec2(0.5, 0.5)), radius: uniform(0.16), aspect: uniform(1) }
        return this.hole
    }
    // 0 at the player's spot on screen, 1 away from it
    holeDistance(inner = 0.55, outer = 1)
    {
        const H = this.holeUniforms(), d = viewportUV.sub(H.center).mul(vec2(H.aspect, 1)).length()
        return smoothstep(H.radius.mul(inner), H.radius.mul(outer), d)
    }

    holeNode()
    {
        const H = this.holeUniforms()
        const rand = fract(sin(dot(screenCoordinate.xy.floor(), vec2(12.9898, 78.233))).mul(43758.5453))
        const d = viewportUV.sub(H.center).mul(vec2(H.aspect, 1)).length()
        const inside = smoothstep(H.radius, H.radius.mul(0.55), d)
        return step(rand, float(1).sub(materialOpacity.oneMinus().mul(inside).mul(1.2)))
    }

    // grass gets the same shading with its own vertex shader and an up normal on both sides
    // (as in folio-2025's Grass.js: the blade is the ground's colour, its root sits in the shadow colour)
    grassMaterial(grass)
    {
        const T = this.terrain, ground = T.colorNode(T.terrainNode(positionWorld.xz))
        const colorNode = mix(ground.mul(grass.shade), color('#fff1b8'), grass.flower)
        const positionNode = grass.positionNode
        const out = new MeshDefaultMaterial({ colorNode, normalNode: vec3(0, 1, 0), side: THREE.DoubleSide, flipBackNormals: false, hasCoreShadows: true, hasLightBounce: false, shadowNode: grass.tip.oneMinus().pow(1.6).mul(0.85) })
        out.positionNode = positionNode
        out.isMeshDefault = true
        return out
    }

    flight(on) { this.flying = on }

    // ---------------------------------------------------------------- Cycles: interpolate the presets
    update()
    {
        const g = this.game
        if(this.pinned === null) this.progress = (0.08 + (performance.now() - this.start) / 1000 / DAY) % 1
        let a = KEYS[0], b = KEYS[1]
        for(let i = 0; i < KEYS.length - 1; i++) if(this.progress >= KEYS[i][1] && this.progress <= KEYS[i + 1][1]) { a = KEYS[i]; b = KEYS[i + 1]; break }
        const t = b[1] > a[1] ? THREE.MathUtils.smoothstep(this.progress, a[1], b[1]) : 0, pa = PRESETS[a[0]], pb = PRESETS[b[0]]
        for(const k in this.properties)
        {
            const p = this.properties[k]
            if(p.value instanceof THREE.Color) p.value.lerpColors(pa[k], pb[k], t)
            else p.value = pa[k] + (pb[k] - pa[k]) * t
        }
        // the room (Room.js) keeps one daylight, the sun coming in over the open corner
        const inRoom = !!(g.room && g.room.bg)
        if(inRoom) for(const k in this.properties) { const p = this.properties[k], v = PRESETS.day[k]; if(p.value instanceof THREE.Color) p.value.copy(v); else p.value = v }
        const P = this.properties, L = this.lighting, F = this.fog
        const pr = this.progress
        this.nightUniform.value = inRoom ? 0 : THREE.MathUtils.smoothstep(pr, 0.6, 0.7) * (1 - THREE.MathUtils.smoothstep(pr, 0.84, 0.94))

        // sun direction swings with the day (Ligthing.js)
        L.spherical.theta = L.theta + Math.sin(- (this.progress + 9 / 16) * Math.PI * 2) * L.thetaAmplitude
        L.spherical.phi = L.phi + Math.cos(- (this.progress + 9 / 16) * Math.PI * 2) * 0.5 * L.phiAmplitude
        L.direction.setFromSpherical(L.spherical).normalize()
        if(inRoom) L.direction.copy(g.room.sunDir)
        g.stage.sunOffset.copy(L.direction).multiplyScalar(80)
        L.colorUniform.value.copy(P.lightColor.value)
        L.intensityUniform.value = P.lightIntensity.value
        L.shadowColor.value.copy(P.shadowColor.value)

        // the see-through hole follows the player on screen
        if(this.hole)
        {
            const p = (g.modes ? g.modes.activePosition() : g.walker.position).clone(); p.y += 0.6
            const cam2 = g.view.camera; cam2.matrixWorldInverse.copy(cam2.matrixWorld).invert(); p.project(cam2)
            this.hole.center.value.set((p.x + 1) / 2, (1 - p.y) / 2); this.hole.aspect.value = g.viewport.width / g.viewport.height
        }

        // fog (Fog.js): distances from the camera, wider in the jet
        F.colorA.value.copy(P.fogColorA.value); F.colorB.value.copy(P.fogColorB.value)
        const rb = g.room && g.room.bg; if(rb) { F.colorA.value.copy(rb[0]); F.colorB.value.copy(rb[1]) }
        const cam = g.view.camera.position, f = g.view.focusPoint.smoothedPosition, d = cam.distanceTo(f)
        const near = this.flying ? 160 : d + 12, amp = this.flying ? 700 : 110
        F.near.value = near + P.fogNearRatio.value * amp * 0.3
        F.far.value = near + P.fogFarRatio.value * amp
    }
}
