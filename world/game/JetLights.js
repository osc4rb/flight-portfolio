/* JetLights.js — folio-2025's vehicle graphics (Bruno Simon, MIT: World/VisualVehicle.js, Trails.js, Tracks.js) on our
   jet, where they fit an aircraft:
   - lights: the red and green wingtip lights, a white strobe that double-flashes on the fin tips, a red beacon on the
     spine, and a landing light with a beam and a pool on the ground while the gear is down; all glow at night
   - trails: his glowing trails from the wingtips, as white vapour when you pull hard at speed
   - tracks: the main gear leaves tyre tracks on the ground while it rolls (his Tracks)
   - dust: a puff of tyre smoke on touchdown, and dust or spray kicked up under the jet when it flies low and fast */
import * as THREE from 'three/webgpu'
import { uniform, color, uv, float, normalView, positionViewDirection } from 'three/tsl'
import { Game } from '../engine/Game.js'
import { Track, Trails } from './Tracks.js'

const lamp = (hex) =>
{
    const level = uniform(1), m = new THREE.MeshBasicNodeMaterial()
    m.colorNode = color(hex).mul(level)
    m.userData.level = level
    return m
}

export class JetLights
{
    constructor(jet)
    {
        this.game = Game.getInstance()
        this.jet = jet
        this.t = 0
        this.dustT = 0
        this.wasGround = true
        this.setLamps()
        this.setLandingLight()
        this.setTrails()
        this.setTracks()
        this.game.ticker.events.on('tick', () => this.update(), 2.7)
    }

    local(mesh)
    {
        this.jet.group.updateMatrixWorld(true)
        return this.jet.group.worldToLocal(new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()))
    }

    setLamps()
    {
        const j = this.jet, navs = [], tips = []
        j.model.traverse(c => { if(c.isMesh && /^nav/.test(c.name)) navs.push(c); if(c.isMesh && /^fintip/.test(c.name)) tips.push(c) })
        this.red = lamp('#ff2a2a'); this.green = lamp('#22ff55')
        for(const n of navs)
        {
            const p = this.local(n)
            n.material = p.z < 0 ? this.red : this.green                       // left wingtip red, right green
            n.userData.keepMaterial = true; n.castShadow = false
        }
        // strobes on the fin tips and a beacon on the spine: small lamps of our own
        const bulb = new THREE.SphereGeometry(0.09, 10, 6)
        this.strobe = lamp('#ffffff'); this.beacon = lamp('#ff3a2a')
        for(const t of tips) { const m = new THREE.Mesh(bulb, this.strobe); m.position.copy(this.local(t)).add(new THREE.Vector3(- 0.6, 0.1, 0)); m.userData.keepMaterial = true; m.castShadow = false; j.group.add(m) }
        const b = new THREE.Mesh(bulb, this.beacon); b.position.set(0.4, j.gearH + 1.25, 0); b.scale.setScalar(1.3); b.userData.keepMaterial = true; b.castShadow = false
        j.group.add(b)
        this.navWing = navs.map(n => this.local(n))
    }

    // a landing light on the nose gear: a soft beam and a pool on the runway ahead, by night, while the gear is down
    setLandingLight()
    {
        const j = this.jet
        this.landing = lamp('#fff3d6')
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 6), this.landing)
        head.position.set(3.55, 0.75, 0); head.userData.keepMaterial = true; head.castShadow = false
        j.gear.add(head)
        const opacity = this.beamOpacity = uniform(0)
        const beam = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
        beam.colorNode = color('#ffe7b0')
        beam.opacityNode = uv().y.pow(2.2).mul(normalView.dot(positionViewDirection).abs().pow(1.6)).mul(opacity).mul(0.2)
        const length = 16, cone = new THREE.ConeGeometry(2.6, length, 24, 1, true)
        cone.translate(0, - length / 2, 0); cone.rotateZ(Math.PI / 2)
        const m = new THREE.Mesh(cone, beam)
        m.position.copy(head.position); m.rotation.z = - 0.05
        m.renderOrder = 2; m.frustumCulled = false; m.castShadow = false; m.userData.keepMaterial = true; m.userData.noReveal = true
        j.gear.add(m)
        const pool = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
        pool.colorNode = color('#ffdca0')
        pool.opacityNode = float(1).sub(uv().sub(0.5).mul(2).length()).clamp(0, 1).pow(1.5).mul(opacity).mul(0.3)
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(16, 7), pool)
        plane.rotation.x = - Math.PI / 2; plane.position.set(13, 0.05, 0)
        plane.renderOrder = 2; plane.castShadow = false; plane.userData.keepMaterial = true; plane.userData.noReveal = true
        j.gear.add(plane)
    }

    setTrails()
    {
        this.trails = new Trails({ head: '#ffffff', tail: '#cfe6ff', strength: 1.4, radius: 0.07 })
        this.trails.decay = 0.35
        this.trailRefs = this.navWing.map(p => { const o = new THREE.Object3D(); o.position.copy(p).add(new THREE.Vector3(- 0.3, 0, 0)); this.jet.group.add(o); return { ref: o, item: this.trails.create() } })
    }

    // the two main wheels (Jet.js gear legs at x -1.2, z +-1.5)
    setTracks()
    {
        const t = this.game.tracks
        this.wheels = [ - 1.5, 1.5 ].map(z => ({ local: new THREE.Vector3(- 1.2, 0, z), track: t ? t.add(new Track(0.14, 'r')) : null }))
    }

    update()
    {
        const g = this.game, j = this.jet, s = j.state, dt = g.ticker.delta
        this.t += dt
        const night = g.look ? g.look.nightUniform.value : 0
        const flying = s.pilot && !s.ground

        // lights: steady wingtips, a double-flash strobe every 1.2 s, a slower beacon
        const k = 3 + night * 4
        this.red.userData.level.value = k; this.green.userData.level.value = k
        const c = this.t % 1.2
        this.strobe.userData.level.value = (c < 0.05 || (c > 0.15 && c < 0.2)) ? 8 : 0.5
        this.beacon.userData.level.value = (this.t % 1.6) < 0.25 ? 6 : 0.6
        const gearDown = j.gear.visible !== false
        this.landing.userData.level.value = gearDown ? 1.2 + night * 5 : 0.5
        this.beamOpacity.value = gearDown && s.pilot ? night : 0

        // vapour from the wingtips when you pull hard at speed
        const pull = Math.abs(s.bank) > 0.9 || (g.player && Math.abs(g.player.accelerating) > 0.5 && Math.abs(s.bank) > 0.3)
        const vapour = flying && s.v > 45 && pull ? 1 : 0
        for(const t of this.trailRefs) { t.ref.getWorldPosition(t.item.position); t.item.alpha = vapour }

        // tyre tracks while rolling on the ground
        const p = new THREE.Vector3()
        for(const w of this.wheels)
        {
            if(!w.track) continue
            p.copy(w.local).applyMatrix4(j.group.matrixWorld)
            w.track.update(p, s.ground && s.v > 0.5)
        }

        // touchdown smoke, and dust or spray under the jet when it is low and fast
        const juice = g.juice
        if(juice && s.ground && !this.wasGround && s.pilot)
        {
            for(const w of this.wheels) { p.copy(w.local).applyMatrix4(j.group.matrixWorld); juice.dust(p, 6, { color: '#e6e2da', spread: 0.5, up: 1, size: 0.8, life: 1.1 }) }
        }
        this.wasGround = s.ground
        if(juice && flying && s.v > 30)
        {
            const ground = g.stage.height(j.position.x, j.position.z), surface = g.water ? g.water.surfaceElevation : - 0.4
            const floor = Math.max(ground, surface), h = j.position.y - floor
            this.dustT -= dt
            if(h < 7 && this.dustT <= 0)
            {
                this.dustT = 0.03
                const wet = ground < surface
                p.set(j.position.x - j.forward.x * 4 + (Math.random() - 0.5) * 4, floor + 0.2, j.position.z - j.forward.z * 4 + (Math.random() - 0.5) * 4)
                juice.dust(p, 2, { color: wet ? '#f2fbff' : '#d8cdb4', spread: 1.5, up: 2.5 * (1 - h / 7) + 0.5, size: 1.1, life: 0.9 })
            }
        }
    }
}
