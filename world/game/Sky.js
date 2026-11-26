/* Sky.js — the flight takes on two of folio-2025's jokes.
   - Social (his statue and links): a blimp circles the island towing a banner with the first contact link from
     site.js. Fly close, or click it from the ground, and the contact links pop up in the HUD.
   - Easter egg: a small gold ring spins over the tallest peak. Fly through it to find it.
   Both are built in code. */
import * as THREE from 'three/webgpu'
import { Game } from '../engine/Game.js'

const ORBIT = { r: 112, y: 58, speed: 0.035 }

export class Sky
{
    constructor()
    {
        this.game = Game.getInstance()
        this.links = ((this.game.site.contact || {}).links || []).filter(l => l.href)
        this.setBlimp()
        this.setSecret()
        this.game.ticker.events.on('tick', () => this.update(), 11)
    }

    setBlimp()
    {
        const g = this.blimp = new THREE.Group(), lam = c => new THREE.MeshLambertMaterial({ color: c })
        const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), lam('#f2f0e5')); hull.scale.set(9, 3, 3); g.add(hull)
        const band = new THREE.Mesh(new THREE.CylinderGeometry(3.02, 3.02, 1.4, 28, 1, true).rotateZ(Math.PI / 2), lam('#f2c94c')); band.position.x = 1.5; g.add(band)
        const gondola = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1.2), lam('#2d2c2b')); gondola.position.set(0.5, - 3.2, 0); g.add(gondola)
        for(const [ ry, rx ] of [ [ 0, 0 ], [ 0, Math.PI / 2 ] ])
        {
            const fin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.2, 0.2), lam('#f2c94c')); fin.position.x = - 7.6; fin.rotation.set(rx, ry, 0); g.add(fin)
        }
        // the banner it tows: the first contact link with an address
        const c = document.createElement('canvas'); c.width = 1024; c.height = 160
        const x = c.getContext('2d'); x.fillStyle = '#100f0f'; x.fillRect(0, 0, 1024, 160)
        x.fillStyle = '#f2c94c'; x.fillRect(0, 0, 1024, 10); x.fillRect(0, 150, 1024, 10)
        x.fillStyle = '#f2f0e5'; x.font = '600 84px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'
        x.fillText(this.links[0] ? this.links[0].label : '', 512, 84)
        const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
        this.banner = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.4, 12, 1).translate(- 11, 0, 0), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }))
        this.banner.position.set(- 14, - 2, 0); this.banner.userData.keepMaterial = true
        this.bannerBase = Float32Array.from(this.banner.geometry.attributes.position.array)
        const rope = new THREE.Mesh(new THREE.BoxGeometry(5, 0.06, 0.06).translate(- 2.5, 0, 0), lam('#2d2c2b')); rope.position.set(- 9, - 1, 0); rope.rotation.z = - 0.2
        g.add(this.banner, rope)
        g.traverse(o => { if(o.isMesh) o.castShadow = true })
        this.game.scene.add(g)
        this.angle = 0.6
    }

    setSecret()
    {
        const peaks = (this.game.course ? this.game.course.obstacles : []).filter(o => o.kind === 'peak' && o.y === 0)
        if(!peaks.length) return
        const top = peaks.reduce((a, b) => b.h > a.h ? b : a)
        this.secret = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.4, 8, 32), new THREE.MeshBasicMaterial({ color: '#ffd34d' }))
        this.secret.position.set(top.x, top.h * 1.18 + 7, top.z)
        this.secret.rotation.y = Math.atan2(top.x, top.z)                                     // faces the island
        this.secret.userData.keepMaterial = true
        this.game.scene.add(this.secret)
        this.found = false
    }

    showLinks()
    {
        if(!this.links.length) return
        this.game.hud.links(this.links)
        this.game.sound.pop(true)
    }

    update()
    {
        const g = this.game, dt = g.ticker.delta, t = g.ticker.elapsed
        // the blimp: a slow circle, nose along the path, a gentle bob; the banner ripples
        this.angle += ORBIT.speed * dt
        const a = this.angle, b = this.blimp
        b.position.set(Math.cos(a) * ORBIT.r, ORBIT.y + Math.sin(t * 0.6) * 1.2, - Math.sin(a) * ORBIT.r)
        b.rotation.set(0, a + Math.PI / 2, Math.sin(t * 0.5) * 0.04)
        const pos = this.banner.geometry.attributes.position, base = this.bannerBase
        for(let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(base[i * 3] * 0.35 + t * 4) * 0.5 * (- base[i * 3] / 22))
        pos.needsUpdate = true

        if(g.mode === 'fly' && !g.jet.state.ground)
        {
            const p = g.jet.position
            if(p.distanceTo(b.position) < 26 && performance.now() - (this.hiT ?? - 1e9) > 12000)
            {
                this.hiT = performance.now()
                this.showLinks(); g.juice.sparkle(b.position.clone(), 20, '#f2c94c'); g.sound.chime()
                g.achievements && g.achievements.unlock('blimp')
            }
            if(this.secret && !this.found && p.distanceTo(this.secret.position) < 4.6)
            {
                this.found = true
                g.juice.confetti(this.secret.position.clone(), 80); g.juice.shake(0.2); g.sound.chime()
                g.hud.toast('The secret ring', true)
                g.achievements && g.achievements.unlock('secret')
            }
        }
        if(this.secret) this.secret.rotation.z = t * 1.5
    }
}
