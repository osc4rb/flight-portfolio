/* Desk.js — the computer inside the computer. A desk by the airstrip with a monitor; E (or a click) glides the
   camera into the screen, and the screen becomes the real résumé page (../index.html?plain=1) in an iframe laid on
   the 3D screen with three's CSS3DRenderer. Technique after Henry Heffernan's portfolio-website (MIT): a CSS3D
   iframe matched to a screen plane and a camera move into it. The desk and monitor are our own boxes. */
import * as THREE from 'three/webgpu'
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js'
import { Game } from '../engine/Game.js'

const SPOT = { x: - 78, z: - 99, yaw: 0, scale: 1.7 }      // faces +z, toward the default camera corner
const SCREEN = { w: 1.6, h: 0.9 }                          // metres, before the desk scale
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(- 2 * t + 2, 3) / 2

export class Desk
{
    constructor()
    {
        this.game = Game.getInstance()
        this.state = 'idle'                                 // idle | in | on | out
        this.setModel()
        this.setCss()
        this.game.ticker.events.on('tick', () => this.update(), 999)
    }

    get position() { return this.group.position }
    // where you stand to use it
    get front() { return this.group.localToWorld(new THREE.Vector3(0, 0, 1.6)) }

    setModel()
    {
        const g = this.group = new THREE.Group()
        const src = this.game.stage.models.desk
        if(src)
        {
            // our Blender desk: its plane named "Screen" (1.6 x 0.9, facing +z) carries the picture and the page
            const model = src.scene.clone(true)
            model.traverse(c => { if(c.isMesh) { c.castShadow = c.receiveShadow = true } })
            this.screen = model.getObjectByName('Screen')
            const pic = this.picture(); pic.flipY = false                                  // glTF UVs run top-down
            this.screen.material = new THREE.MeshBasicMaterial({ map: pic }); this.screen.userData.keepMaterial = true
            this.screen.castShadow = false
            g.add(model)
        }
        else this.boxes(g)
        this.place(g)
    }

    // the stand-in desk from boxes, if the model did not load
    boxes(g)
    {
        const box = (w, h, d, color, x, y, z, parent = g) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color })); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; parent.add(m); return m }
        const wood = '#b9824f', dark = '#2a2928', metal = '#9aa0a6'
        box(2.6, 0.08, 1.1, wood, 0, 0.76, 0)
        for(const [ x, z ] of [ [ - 1.2, - 0.45 ], [ 1.2, - 0.45 ], [ - 1.2, 0.45 ], [ 1.2, 0.45 ] ]) box(0.07, 0.72, 0.07, dark, x, 0.36, z)
        box(0.5, 0.02, 0.3, dark, 0, 0.81, - 0.25)                                    // monitor foot
        box(0.08, 0.32, 0.06, dark, 0, 0.96, - 0.3)                                   // neck
        box(SCREEN.w + 0.08, SCREEN.h + 0.08, 0.05, dark, 0, 1.12 + SCREEN.h / 2, - 0.34)  // bezel
        box(0.9, 0.025, 0.28, '#3a3937', 0, 0.81, 0.2)                                // keyboard
        box(0.07, 0.03, 0.11, '#3a3937', 0.62, 0.81, 0.22)                            // mouse
        const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.12, 14), new THREE.MeshLambertMaterial({ color: '#f2c94c' })); mug.position.set(- 0.85, 0.86, 0.05); g.add(mug)
        // chair
        box(0.55, 0.06, 0.55, dark, 0, 0.5, 0.95); box(0.55, 0.6, 0.06, dark, 0, 0.82, 1.22); box(0.06, 0.48, 0.06, metal, 0, 0.24, 0.95)

        // the screen: a picture of the résumé while idle, the live page once you sit down
        this.screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), new THREE.MeshBasicMaterial({ map: this.picture() }))
        this.screen.position.set(0, 1.12 + SCREEN.h / 2, - 0.31); this.screen.userData.keepMaterial = true
        g.add(this.screen)
    }

    place(g)
    {
        const h = this.game.stage.height(SPOT.x, SPOT.z)
        g.position.set(SPOT.x, h, SPOT.z); g.rotation.y = SPOT.yaw; g.scale.setScalar(SPOT.scale)
        this.game.scene.add(g)
        g.updateMatrixWorld(true)
        const wb = new THREE.Box3().setFromObject(g), ws = wb.getSize(new THREE.Vector3()), wc = wb.getCenter(new THREE.Vector3())
        ws.z -= 0.8 * SPOT.scale; wc.z -= 0.4 * SPOT.scale                            // the chair stays walkable
        this.game.objects.add(null, { type: 'fixed', colliders: [ { shape: 'cuboid', parameters: [ ws.x / 2, ws.y / 2, ws.z / 2 ], position: wc } ] })
    }

    // a drawing of the résumé page from site.js: name, lede, section titles, muted lines
    picture()
    {
        const S = this.game.site || {}, H = S.home || {}, c = document.createElement('canvas'), W = 1024, Hh = 576
        c.width = W; c.height = Hh
        const x = c.getContext('2d'), col = 300
        x.fillStyle = '#100f0f'; x.fillRect(0, 0, W, Hh)
        x.fillStyle = '#cecdc3'; x.font = '600 26px system-ui, sans-serif'; x.fillText(S.name || '', col, 70)
        x.fillStyle = '#878580'; x.font = '15px system-ui, sans-serif'
        const lede = String(H.lede || '').replace(/\*\*/g, '').slice(0, 70); x.fillText(lede, col, 100)
        let y = 150
        for(const s of (H.sections || []).slice(0, 5))
        {
            x.fillStyle = '#cecdc3'; x.font = '600 15px system-ui, sans-serif'; x.fillText(s.title || '', col, y); y += 22
            for(let i = 0; i < Math.min(3, (s.items || []).length); i++) { x.fillStyle = '#282726'; x.fillRect(col, y - 9, 330 + (i * 97 % 90), 7); x.fillStyle = '#3d3b39'; x.fillRect(col + 360 + (i * 37 % 40), y - 9, 50, 7); y += 16 }
            y += 16
        }
        x.fillStyle = '#f2c94c'; x.fillRect(col, Hh - 46, 64, 6)
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
        return t
    }

    setCss()
    {
        this.css = new CSS3DRenderer()
        const el = this.css.domElement
        el.className = 'desk-css'; el.hidden = true
        document.querySelector('.game').insertBefore(el, document.getElementById('hud'))
        this.cssScene = new THREE.Scene()
        addEventListener('resize', () => this.css.setSize(innerWidth, innerHeight))
        this.css.setSize(innerWidth, innerHeight)
        addEventListener('keydown', e => { if(e.key === 'Escape' && this.state === 'on') this.leave() })
    }

    // the live page, made on first use so the world loads without it
    frame()
    {
        if(this.obj) return
        const px = this.px = Math.round(Math.min(1600, Math.max(960, innerWidth)))
        const wrap = document.createElement('div'); wrap.className = 'desk-screen'
        wrap.style.width = px + 'px'; wrap.style.height = Math.round(px * SCREEN.h / SCREEN.w) + 'px'
        const f = document.createElement('iframe'); f.src = '../index.html?plain=1'; f.title = (this.game.site.name || '') + ' résumé'
        // Esc inside the page (same origin) stands up too
        f.addEventListener('load', () => { try { f.contentWindow.addEventListener('keydown', e => { if(e.key === 'Escape') this.leave() }) } catch(e) {} })
        wrap.appendChild(f)
        this.wrap = wrap
        this.obj = new CSS3DObject(wrap)
        this.cssScene.add(this.obj)
    }

    // ---------------------------------------------------------------- sit down, stand up
    use()
    {
        if(this.state !== 'idle') return
        if(innerWidth < 700) { location.href = '../index.html'; return }         // a phone screen is too small for a screen in a screen
        const g = this.game
        this.frame()
        this.state = 'in'; this.t = 0
        g.modes.lock(true); g.modes.desk = this
        g.walker.setActive(false)
        g.hud.prompt(null); g.hud.say(null); g.hud.deskBack(true)
        g.sound.whoosh()
        const cam = g.view.camera
        this.from = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov }
        this.to = this.target(cam)
        g.cameraOverride = c => this.camera(c)
        this.css.domElement.hidden = false
        this.wrap.style.opacity = 0; this.wrap.style.pointerEvents = 'none'
    }

    leave()
    {
        if(this.state !== 'on' && this.state !== 'in') return
        this.state = 'out'; this.t = 0
        this.wrap.style.opacity = 0; this.wrap.style.pointerEvents = 'none'
        this.game.hud.deskBack(false)
        this.game.sound.pop(false)
        this.game.canvasElement.focus && this.game.canvasElement.focus()
    }

    // the camera pose where the screen just fills the view
    target(cam)
    {
        const S = SPOT.scale, w = SCREEN.w * S, h = SCREEN.h * S, fov = 25, tan = Math.tan(fov * Math.PI / 360)
        const d = Math.max(h / (2 * tan), w / cam.aspect / (2 * tan)) * 1.03
        const c = this.screen.getWorldPosition(new THREE.Vector3()), n = new THREE.Vector3(0, 0, 1).applyQuaternion(this.screen.getWorldQuaternion(new THREE.Quaternion()))
        const pos = c.clone().addScaledVector(n, d), m = new THREE.Matrix4().lookAt(pos, c, new THREE.Vector3(0, 1, 0))
        return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(m), fov }
    }

    camera(cam)
    {
        const k = ease(Math.min(1, this.t)), a = this.state === 'out' ? this.to : this.from, b = this.state === 'out' ? this.from : this.to
        cam.position.lerpVectors(a.pos, b.pos, k)
        cam.quaternion.slerpQuaternions(a.quat, b.quat, k)
        const fov = a.fov + (b.fov - a.fov) * k
        const v = this.game.view
        for(const c of [ v.camera, v.defaultCamera ]) if(Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix() }
    }

    update()
    {
        if(this.state === 'idle') return
        const g = this.game, dt = g.ticker.delta
        if(this.state === 'in' || this.state === 'out')
        {
            this.t += dt / 1.3
            if(this.state === 'in' && this.t > 0.7) this.wrap.style.opacity = Math.min(1, (this.t - 0.7) / 0.3)
            if(this.t >= 1)
            {
                if(this.state === 'in') { this.state = 'on'; this.wrap.style.opacity = 1; this.wrap.style.pointerEvents = 'auto'; g.achievements && g.achievements.unlock('computer') }
                else
                {
                    this.state = 'idle'; g.cameraOverride = null; this.css.domElement.hidden = true
                    g.modes.desk = null; g.modes.lock(false); g.walker.setActive(true)
                    return
                }
            }
        }
        // lay the page on the screen
        const S = SPOT.scale
        this.screen.getWorldPosition(this.obj.position)
        this.screen.getWorldQuaternion(this.obj.quaternion)
        this.obj.scale.setScalar(SCREEN.w * S / this.px)
        this.css.render(this.cssScene, g.view.camera)
    }
}
