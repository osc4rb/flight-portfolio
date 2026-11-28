/* Room.js — the cabin by the start disc, the room inside it, and the doors to Oscar's other sites. After the 3D-room
   portfolios and husam.world's doors (ideas, not code; the sign's structure was measured from his page): walk up to a
   door and a sign slides up with "Go in" (E or Enter). A circle wipe in the door's colour carries the name.
   The cabin's door leads to the room, our Blender scene far under the island:
   - a fixed orbit camera you can nudge with a drag or the wheel
   - the things you can use glow under the pointer, and a click dives the camera into them:
     the computer (the CV, through Desk.js), the board (projects), the shelf (papers), the phone (contact)
   - Esc or Back goes out again
   The other doors open the other sites. Words: site.js → world.room and world.doors. */
import * as THREE from 'three/webgpu'
import { Game } from '../engine/Game.js'
import { label } from './Stations.js'
import { HIDDEN_SPOTS } from './Stage.js'

const ROOM = new THREE.Vector3(- 91.5, - 400, - 107)                // far under the start disc: never in view from the island
const FOV = 30
const CABIN = { x: HIDDEN_SPOTS.cabin[0], z: HIDDEN_SPOTS.cabin[1], yaw: Math.PI / 4, scale: 1.4 }   // out in the hills, found by exploring
const DOORS = HIDDEN_SPOTS.doors.map(([ x, z ]) => ({ x, z }))     // the doorways, in site.js order after the room
const DOORWAY = { scale: 1.05, yaw: Math.PI / 4 }
const NEAR = 3.2                                                    // m from a door's front: the sign shows
// what you can use in the room: its nodes, the way the camera looks at it, and how much of it fills the view (m)
const THINGS = [
    { id: 'computer', nodes: [ 'Computer', 'Screen' ] },
    { id: 'board', nodes: [ 'Board', 'BoardFace' ], normal: [ 0, 0.12, 1 ], fit: 1.35 },
    { id: 'shelf', nodes: [ 'Shelf' ], normal: [ 1, 0.15, 0.3 ], fit: 2.3 },
    { id: 'phone', nodes: [ 'Phone' ], normal: [ 0.75, 0.8, 0.55 ], fit: 0.85 },
]
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(- 2 * t + 2, 3) / 2
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export class Room
{
    constructor()
    {
        const g = this.game = Game.getInstance(), W = g.site.world || {}
        this.words = W.room || {}
        this.state = 'off'                  // off | orbit | dive | panel | back | desk
        this.doors = []
        this.things = []
        this.drag = { x: 0, y: 0, tx: 0, ty: 0, zoom: 1, tz: 1 }
        this.center = ROOM.clone().add(new THREE.Vector3(0, 1.05, 0))
        this.sunDir = new THREE.Vector3(0.45, 0.88, - 0.1).normalize()  // Look.js: the room's one daylight (chosen in the pane: lights both walls and the floor)
        this.setCabin((W.doors || []).find(d => !d.href))
        this.setDoors((W.doors || []).filter(d => d.href))
        this.setRoom()
        this.setUi()
        this.setPointer()
        g.ticker.events.on('tick', () => this.update(), 998)
    }

    // ---------------------------------------------------------------- the cabin and the doorways on the island
    put(name, x, z, yaw, scale)
    {
        const g = this.game, src = g.stage.models[name]; if(!src) return null
        const obj = src.scene.clone(true)
        obj.scale.setScalar(scale); obj.rotation.y = yaw
        obj.position.set(x, g.stage.height(x, z), z)
        obj.traverse(c => { if(c.isMesh) { c.castShadow = c.receiveShadow = true } })
        g.scene.add(obj)
        obj.updateMatrixWorld(true)
        return obj
    }

    // a box collider turned with the model (Stage.place uses the world box, too big for a turned house)
    collide(obj, size, centre)
    {
        const c = obj.localToWorld(new THREE.Vector3(...centre))
        this.game.objects.add(null, { type: 'fixed', friction: 0.5, colliders: [ { shape: 'cuboid', parameters: size.map((v, i) => v / 2 * obj.scale.x), position: c, quaternion: obj.quaternion.clone() } ] })
    }

    door(d, obj, frontZ, topY)
    {
        d.obj = obj
        d.front = obj.localToWorld(new THREE.Vector3(0, 0, frontZ))
        d.front.y = this.game.stage.height(d.front.x, d.front.z)
        d.top = obj.localToWorld(new THREE.Vector3(0, topY, 0))
        d.face = obj.rotation.y
        this.doors.push(d)
    }

    setCabin(d)
    {
        if(!d) return
        const obj = this.put('cabin', CABIN.x, CABIN.z, CABIN.yaw, CABIN.scale); if(!obj) return
        this.collide(obj, [ 5.2, 4.4, 4.3 ], [ 0, 2.2, 0 ])
        this.door({ ...d, room: true }, obj, 3.3, 5.6)
    }

    setDoors(list)
    {
        list.slice(0, DOORS.length).forEach((d, i) =>
        {
            const p = DOORS[i], obj = this.put('doorway', p.x, p.z, DOORWAY.yaw, DOORWAY.scale); if(!obj) return
            obj.traverse(c => { if(c.isMesh && c.name === 'Panel') { c.material = c.material.clone(); c.material.color.set(d.color || '#3d5a73') } })
            this.collide(obj, [ 0.2, 2.9, 0.24 ], [ - 0.68, 1.45, 0 ])
            this.collide(obj, [ 0.2, 2.9, 0.24 ], [ 0.68, 1.45, 0 ])
            this.door({ ...d, lift: 0.5 }, obj, 1.4, 2.9)
        })
    }

    // ---------------------------------------------------------------- the room
    setRoom()
    {
        const g = this.game, src = g.stage.models.room; if(!src) return
        const room = this.room = src.scene.clone(true)
        room.position.copy(ROOM)
        // the light is baked into the vertex colours (bake_models.py): unlit, no shadows, no fog, no tone mapping
        room.traverse(c =>
        {
            if(!c.isMesh) return
            c.material = new THREE.MeshBasicMaterial({ vertexColors: !!c.geometry.attributes.color, toneMapped: false }); c.material.fog = false
            c.userData.keepMaterial = true; c.castShadow = c.receiveShadow = false
        })
        g.scene.add(room)
        room.updateMatrixWorld(true)
        // the computer's screen shows the same drawing of the résumé as the desk's; the live page is laid on it on use
        this.screen = room.getObjectByName('Screen')
        if(this.screen)
        {
            const pic = g.desk.picture(); pic.flipY = false
            this.screen.material = new THREE.MeshBasicMaterial({ map: pic }); this.screen.userData.keepMaterial = true; this.screen.castShadow = false
        }
        const face = room.getObjectByName('BoardFace')
        if(face) { const t = this.board(); t.flipY = false; face.material = new THREE.MeshBasicMaterial({ map: t, vertexColors: !!face.geometry.attributes.color, toneMapped: false }); face.material.fog = false; face.castShadow = false }
        this.chair = room.getObjectByName('Chair'); this.chairYaw = this.chair ? this.chair.rotation.y : 0
        this.setSteam(room.getObjectByName('Steam'))

        const L = this.words.labels || {}
        for(const T of THINGS)
        {
            const meshes = T.nodes.map(n => room.getObjectByName(n)).filter(Boolean)
            if(!meshes.length) continue
            const box = new THREE.Box3(); meshes.forEach(m => box.expandByObject(m))
            const tag = L[T.id] ? label(L[T.id], '#f2c94c') : null
            if(tag) { tag.scale.multiplyScalar(0.3); tag.position.set((box.min.x + box.max.x) / 2, box.max.y + 0.28, (box.min.z + box.max.z) / 2); tag.visible = false; g.scene.add(tag) }
            this.things.push({ ...T, meshes, box, tag, glow: [], amount: 0 })
        }
    }

    // steam over the mug: a few soft puffs rising and fading in turn
    setSteam(at)
    {
        if(!at) return
        const mat = () => { const m = new THREE.SpriteMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }); m.fog = false; return m }
        this.steam = []
        for(let i = 0; i < 5; i++)
        {
            const s = new THREE.Sprite(mat()); s.userData.keepMaterial = true; s.userData.noReveal = true
            s.position.copy(at.getWorldPosition(new THREE.Vector3()))
            this.game.scene.add(s)
            this.steam.push({ s, base: s.position.clone(), phase: i / 5 })
        }
    }

    // the corkboard: one card per project from site.js → home.projects, pinned in a grid
    board()
    {
        const P = ((this.game.site.home || {}).projects || []).slice(0, 9), c = document.createElement('canvas'), W = 1536, H = 1024
        c.width = W; c.height = H
        const x = c.getContext('2d')
        x.fillStyle = '#c49a6c'; x.fillRect(0, 0, W, H)
        for(let i = 0; i < 2600; i++) { x.fillStyle = i % 3 ? 'rgba(90,55,25,.18)' : 'rgba(255,235,200,.16)'; const r = 1 + (i * 7 % 4); x.fillRect((i * 997) % W, (i * 389 + i * i) % H, r, r) }
        const paper = [ '#f6f1e4', '#fbe7a1', '#d9ecf2', '#f6f1e4', '#e4f1dc', '#f9dcd2', '#f6f1e4', '#fbe7a1', '#d9ecf2' ]
        const pins = [ '#c8443b', '#3d5a73', '#f2c94c', '#5b8c5a' ]
        const cw = 440, ch = 270, gx = (W - 3 * cw) / 4, gy = (H - 3 * ch) / 4
        P.forEach((p, i) =>
        {
            const col = i % 3, row = Math.floor(i / 3), cx = gx + col * (cw + gx) + cw / 2, cy = gy + row * (ch + gy) + ch / 2
            x.save(); x.translate(cx, cy); x.rotate(((i * 37) % 7 - 3) * 0.012)
            x.fillStyle = 'rgba(40,20,5,.28)'; x.fillRect(- cw / 2 + 6, - ch / 2 + 8, cw, ch)
            x.fillStyle = paper[i]; x.fillRect(- cw / 2, - ch / 2, cw, ch)
            x.fillStyle = '#6b655c'; x.font = '600 24px system-ui, sans-serif'; x.fillText(String(p.tag || '').toUpperCase().slice(0, 30), - cw / 2 + 28, - ch / 2 + 68)
            x.fillStyle = '#1d1c1b'; x.font = '700 40px system-ui, sans-serif'
            let line = '', y = - ch / 2 + 124
            for(const w of String(p.title || '').split(' '))
            {
                if(x.measureText(line + w).width > cw - 56 && line) { x.fillText(line.trim(), - cw / 2 + 28, y); y += 46; line = '' }
                line += w + ' '
            }
            x.fillText(line.trim(), - cw / 2 + 28, y)
            x.fillStyle = pins[i % pins.length]; x.beginPath(); x.arc(0, - ch / 2 + 20, 13, 0, Math.PI * 2); x.fill()
            x.fillStyle = 'rgba(255,255,255,.45)'; x.beginPath(); x.arc(- 4, - ch / 2 + 16, 4, 0, Math.PI * 2); x.fill()
            x.restore()
        })
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
        return t
    }

    // called by Modes.start, after Look converted the materials: each thing gets its own copy to glow with
    start()
    {
        for(const t of this.things)
            for(const m of t.meshes) m.traverse(c => { if(c.isMesh && c.material && (c.material.emissive || c.material.isMeshBasicMaterial)) { c.material = c.material.clone(); t.glow.push(c.material) } })
    }

    // ---------------------------------------------------------------- the sign, the wipe, the back button
    setUi()
    {
        const hud = this.hud = document.getElementById('hud')
        this.exit = document.createElement('div'); this.exit.className = 'r-exit'; this.exit.setAttribute('aria-live', 'polite')
        this.exit.innerHTML = `<div class="r-sign"><div class="r-tab"></div><div class="r-name"></div><button type="button" class="r-go"><span></span> <kbd aria-hidden="true">E</kbd></button></div>`
        this.exit.querySelector('.r-go').addEventListener('click', () => this.signed && this.go(this.signed))
        hud.appendChild(this.exit)
        this.back = document.createElement('button'); this.back.type = 'button'; this.back.className = 'h-btn h-roomback'; this.back.hidden = true
        this.back.innerHTML = `${esc(this.words.back)} <kbd>Esc</kbd>`; this.back.title = this.words.backTitle || ''
        this.back.addEventListener('click', () => this.close())
        hud.appendChild(this.back)
        this.wipeEl = document.createElement('div'); this.wipeEl.className = 'r-wipe'; this.wipeEl.innerHTML = '<b></b>'
        document.body.appendChild(this.wipeEl)
        // back from another site through the browser's back button: the page comes back from the cache still covered
        addEventListener('pageshow', e => { if(e.persisted) { this.wipeEl.className = 'r-wipe'; this.busy = false } })
    }

    // the door you stand at, if any
    near(p)
    {
        for(const d of this.doors) if(Math.hypot(p.x - d.front.x, p.z - d.front.z) < NEAR) return d
        return null
    }

    sign(d)
    {
        if(d === this.signed) return
        this.signed = d
        if(!d) { this.exit.classList.remove('show'); return }
        this.exit.querySelector('.r-tab').textContent = d.tab || ''
        this.exit.querySelector('.r-name').textContent = d.name || ''
        this.exit.querySelector('.r-go span').textContent = d.go || ''
        this.exit.classList.add('show')
        this.game.sound && this.game.sound.tick()
    }

    // a circle in the door's colour grows from the door, with the name; the callback runs while the screen is covered
    wipe(d, callback, reveal)
    {
        const w = this.wipeEl, g = this.game, p = (d.top || this.center).clone().project(g.view.camera)
        this.busy = true
        w.style.setProperty('--wx', ((p.x + 1) / 2 * 100).toFixed(1) + '%')
        w.style.setProperty('--wy', ((1 - p.y) / 2 * 100).toFixed(1) + '%')
        w.style.setProperty('--wb', d.color || '#f2c94c')
        w.querySelector('b').textContent = d.name || ''
        w.className = 'r-wipe'; void w.offsetWidth; w.classList.add('go')
        g.sound && g.sound.whoosh()
        setTimeout(() =>
        {
            callback && callback()
            if(!reveal) return
            setTimeout(() =>
            {
                w.style.setProperty('--wx', '50%'); w.style.setProperty('--wy', '50%')
                w.classList.add('out'); w.classList.remove('go')
                setTimeout(() => { w.className = 'r-wipe'; this.busy = false }, 650)
            }, 380)
        }, 820)
    }

    go(d)
    {
        if(this.busy || !d) return
        const g = this.game
        if(this.state !== 'off') return
        if(d.href) { this.sign(null); this.wipe(d, () => { location.href = d.href }); return }
        this.sign(null)
        g.modes.lock(true); g.walker.setActive(false); g.hud.prompt(null)
        this.wipe(d, () => this.enter(), true)
    }

    // ---------------------------------------------------------------- in and out
    enter()
    {
        const g = this.game, v = g.view
        this.state = 'orbit'
        this.fov = v.camera.fov
        this.drag.x = this.drag.tx = 0; this.drag.y = this.drag.ty = 0; this.drag.zoom = this.drag.tz = 1
        g.cameraOverride = cam => this.camera(cam)
        this.sunAt = ROOM
        this.bg = [ new THREE.Color('#161314'), new THREE.Color('#0c0b0b') ]   // the dark void the measured rooms float on
        this.hud.classList.add('in-room')
        this.back.hidden = false
        g.achievements && g.achievements.unlock('room')
    }

    close()
    {
        if(this.state !== 'orbit' || this.busy) return
        const d = this.doors.find(d => d.room)
        this.setHover(null)
        this.wipe(d, () => this.leave(d), true)
    }

    leave(d)
    {
        const g = this.game, v = g.view
        this.state = 'off'
        g.cameraOverride = null
        for(const c of [ v.camera, v.defaultCamera ]) { c.fov = this.fov; c.updateProjectionMatrix() }
        this.sunAt = null; this.bg = null
        this.hud.classList.remove('in-room')
        this.back.hidden = true
        g.walker.setActive(true)
        g.walker.moveTo(d.front.clone().add(new THREE.Vector3(Math.sin(d.face), 0, Math.cos(d.face)).multiplyScalar(1.2)).setY(d.front.y + 1.2), d.face)
        g.modes.lock(false)
    }

    // ---------------------------------------------------------------- pointer: drag to look, hover to glow, click to dive
    setPointer()
    {
        this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2()
        const cv = this.game.canvasElement
        cv.addEventListener('pointerdown', e =>
        {
            if(this.state !== 'orbit') return
            this.down = { x: e.clientX, y: e.clientY, tx: this.drag.tx, ty: this.drag.ty, t: performance.now(), moved: false }
        })
        addEventListener('pointermove', e =>
        {
            if(this.state !== 'orbit') return
            this.pointer = e
            const d = this.down
            if(d)
            {
                const mx = e.clientX - d.x, my = e.clientY - d.y
                if(Math.hypot(mx, my) > 6) d.moved = true
                this.drag.tx = clamp(d.tx - mx / innerWidth * 1.4, - 0.5, 0.5)
                this.drag.ty = clamp(d.ty + my / innerHeight * 0.9, - 0.25, 0.4)
            }
            this.pick()
        })
        addEventListener('pointerup', e =>
        {
            const d = this.down; this.down = null
            if(!d || this.state !== 'orbit' || d.moved || performance.now() - d.t > 500) return
            this.pointer = e; this.pick()
            if(this.hover) this.use(this.hover)
        })
        cv.addEventListener('wheel', e => { if(this.state === 'orbit') this.drag.tz = clamp(this.drag.tz * (1 + Math.sign(e.deltaY) * 0.08), 0.72, 1.15) }, { passive: true })
    }

    pick()
    {
        if(this.state !== 'orbit' || !this.pointer) { this.setHover(null); return }
        const r = this.game.canvasElement.getBoundingClientRect()
        this.ndc.set((this.pointer.clientX - r.left) / r.width * 2 - 1, - (this.pointer.clientY - r.top) / r.height * 2 + 1)
        this.ray.setFromCamera(this.ndc, this.game.view.camera)
        const hits = this.ray.intersectObject(this.room, true)
        let best = null
        for(const h of hits)
        {
            best = this.things.find(t => t.meshes.some(m => m === h.object || m.getObjectById(h.object.id)))
            break                                       // the nearest surface decides: a wall in front hides what is behind it
        }
        this.setHover(best || null)
    }

    setHover(t)
    {
        if(t === this.hover) return
        if(this.hover && this.hover.tag) this.hover.tag.visible = false
        this.hover = t
        if(t && t.tag) t.tag.visible = true
        this.game.canvasElement.style.cursor = t ? 'pointer' : ''
        if(t) this.game.sound && this.game.sound.tick()
    }

    use(t)
    {
        const g = this.game
        this.setHover(null)
        if(t.id === 'computer')
        {
            if(!this.screen) return
            this.state = 'desk'; this.back.hidden = true
            g.desk.use({ screen: this.screen, scale: 0.5, backLabel: this.words.screenBack, back: () => { this.state = 'orbit'; g.cameraOverride = cam => this.camera(cam); this.back.hidden = false } })
            return
        }
        this.current = t
        this.from = this.orbitPose(); this.to = this.pose(t)
        this.state = 'dive'; this.t = 0; this.back.hidden = true
        g.sound && g.sound.whoosh()
    }

    // the panel for a thing, from site.js
    panel(t)
    {
        const g = this.game, S = g.site, H = S.home || {}, L = this.words.labels || {}, back = this.words.panelBack
        if(t.id === 'board')
            g.hud.panel({ id: 'projects', title: L.board, plain: true, items: (H.projects || []).map(p => ({ when: p.tag, lead: p.title + '.', text: p.text, href: p.href ? (/^https?:/.test(p.href) ? p.href : '../' + p.href) : '' })) }, '#f2c94c', back)
        if(t.id === 'shelf')
        {
            const want = this.words.papers || [], all = (H.sections || []).flatMap(s => s.items || [])
            g.hud.panel({ id: 'research', title: L.shelf, items: want.map(w => all.find(i => i.lead === w)).filter(Boolean) }, '#f2c94c', back)
        }
        if(t.id === 'phone')
        {
            const C = S.contact || {}, items = []
            if(C.email) items.push({ lead: C.email, href: 'mailto:' + C.email })
            for(const l of C.links || []) if(l.href && !/^mailto:/.test(l.href)) items.push({ lead: l.label, href: l.href })
            g.hud.panel({ id: 'contact', title: L.phone, plain: true, items }, '#f2c94c', back)
        }
    }

    // Hud.closePanel calls this while in the room: the camera comes back out
    panelClosed()
    {
        if(this.state !== 'panel') return
        this.state = 'back'; this.t = 0
        this.game.modes.lock(true)
        this.game.sound && this.game.sound.pop(false)
    }

    // ---------------------------------------------------------------- camera
    orbitPose()
    {
        const g = this.game, asp = g.viewport.width / g.viewport.height, tan = Math.tan(FOV * Math.PI / 360), D = this.drag
        const dist = Math.max(7.5, 3.9 / (tan * asp)) * D.zoom              // the room is 4.8 x 4.2 m
        const th = Math.PI / 4 + D.x, ph = 0.46 + D.y
        const pos = this.center.clone().add(new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.sin(ph), Math.cos(th) * Math.cos(ph)).multiplyScalar(dist))
        return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, this.center, new THREE.Vector3(0, 1, 0))) }
    }

    pose(t)
    {
        const g = this.game, asp = g.viewport.width / g.viewport.height, tan = Math.tan(FOV * Math.PI / 360)
        const c = t.box.getCenter(new THREE.Vector3()), n = new THREE.Vector3(...t.normal).normalize()
        // wide screens: the panel docks right (world.css) and the thing sits in the middle of the left half;
        // narrow ones: the panel is centred and the thing sits in the top third, above it
        const wide = innerWidth >= 900
        const dist = (wide ? Math.max(t.fit, t.fit * 1.2 / (asp * 0.5)) : Math.max(t.fit, t.fit * 1.2 / asp)) / (2 * tan) * 1.15
        const pos = c.clone().addScaledVector(n, dist), aim = c.clone()
        if(wide) aim.addScaledVector(new THREE.Vector3().subVectors(c, pos).normalize().cross(new THREE.Vector3(0, 1, 0)).normalize(), dist * tan * asp * 0.48)
        else aim.y -= dist * tan * 0.62
        return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, aim, new THREE.Vector3(0, 1, 0))) }
    }

    camera(cam)
    {
        let p
        if(this.state === 'dive' || this.state === 'back')
        {
            const k = ease(Math.min(1, this.t)), a = this.state === 'dive' ? this.from : this.to, b = this.state === 'dive' ? this.to : this.orbitPose()
            p = { pos: a.pos.clone().lerp(b.pos, k), quat: a.quat.clone().slerp(b.quat, k) }
        }
        else if(this.state === 'panel') p = this.to
        else p = this.orbitPose()
        cam.position.copy(p.pos); cam.quaternion.copy(p.quat)
        const v = this.game.view
        for(const c of [ v.camera, v.defaultCamera ]) if(Math.abs(c.fov - FOV) > 0.01) { c.fov = FOV; c.updateProjectionMatrix() }
    }

    // ---------------------------------------------------------------- tick
    update()
    {
        const g = this.game, dt = g.ticker.delta, time = g.ticker.elapsed
        if(this.state === 'off') return
        // his small touches: the chair sways, the steam rises
        if(this.chair) this.chair.rotation.y = this.chairYaw + Math.sin(time * 0.5) * 0.5
        if(this.steam) for(const p of this.steam)
        {
            const k = (time * 0.35 + p.phase) % 1
            p.s.position.set(p.base.x + Math.sin(time * 1.7 + p.phase * 9) * 0.03 * k, p.base.y + k * 0.32, p.base.z)
            p.s.scale.setScalar(0.05 + k * 0.09); p.s.material.opacity = Math.sin(k * Math.PI) * 0.32
        }
        const D = this.drag, k = Math.min(1, dt * 6)
        D.x += (D.tx - D.x) * k; D.y += (D.ty - D.y) * k; D.zoom += (D.tz - D.zoom) * k
        if(this.state === 'dive' || this.state === 'back')
        {
            this.t += dt / 1.1
            if(this.t >= 1)
            {
                if(this.state === 'dive') { this.state = 'panel'; this.panel(this.current) }
                else { this.state = 'orbit'; this.back.hidden = false; this.pick() }
            }
        }
        for(const t of this.things)
        {
            const want = t === this.hover ? 1 : 0
            if(t.amount === want && !want) continue
            t.amount += (want - t.amount) * Math.min(1, dt * 10)
            if(Math.abs(t.amount - want) < 0.005) t.amount = want
            const pulse = t.amount * (0.3 + Math.sin(time * 6) * 0.08)
            for(const m of t.glow) { if(m.emissive) { m.emissive.setRGB(1, 0.85, 0.45); m.emissiveIntensity = pulse } else m.color.setRGB(1 + pulse * 1.4, 1 + pulse * 1.1, 1 + pulse * 0.6) }   // unlit: brighten the baked colours
            if(t.tag) t.tag.position.y = t.box.max.y + 0.28 + Math.sin(time * 2) * 0.03
        }
    }
}
