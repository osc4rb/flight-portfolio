/* Mailbox.js — the letter, after husam.world's mailbox (structure and timings measured from his page; our own art
   and words). Bump the mailbox with the truck, or walk up and press E: the flag goes up and a letter opens with an
   airmail stripe, the avatar, the email with a Copy button and the links. X, a click outside or Esc closes it.
   Words: site.js → world.mail; the email and links come from site.js → contact. */
import * as THREE from 'three/webgpu'
import { Game } from '../engine/Game.js'

export const MAILBOX = { x: - 88, z: - 95, yaw: Math.PI / 4 }      // in sight of the start disc
const NEAR = 2.8                                                    // m: on foot, E opens it
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export class Mailbox
{
    constructor()
    {
        const g = this.game = Game.getInstance()
        this.words = (g.site.world || {}).mail || {}
        this.isOpen = false
        this.last = 0
        this.position = new THREE.Vector3(MAILBOX.x, g.stage.height(MAILBOX.x, MAILBOX.z), MAILBOX.z)
        this.setModel()
        this.setLetter()
        g.ticker.events.on('tick', () => this.update(), 9.6)
    }

    setModel()
    {
        const g = this.game, m = (c) => new THREE.MeshLambertMaterial({ color: c })
        const group = this.group = new THREE.Group()
        group.position.copy(this.position); group.rotation.y = MAILBOX.yaw
        const mesh = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; group.add(o); return o }
        mesh(new THREE.BoxGeometry(0.16, 1.1, 0.16), m('#6b4a32'), 0, 0.55, 0)                        // the post
        const blue = m('#2f6fb0')
        mesh(new THREE.BoxGeometry(0.46, 0.34, 0.7), blue, 0, 1.27, 0)                                 // the box
        const roof = mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.7, 16, 1, false, 0, Math.PI), blue, 0, 1.44, 0)
        roof.rotation.set(Math.PI / 2, 0, Math.PI / 2)
        mesh(new THREE.BoxGeometry(0.4, 0.34, 0.02), m('#1d3f63'), 0, 1.3, 0.355)                      // the door
        this.flag = new THREE.Group(); this.flag.position.set(0.25, 1.3, - 0.18); group.add(this.flag)
        const f1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.05), m('#c8443b')); f1.position.y = 0.2; f1.castShadow = true
        const f2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.16), m('#c8443b')); f2.position.set(0, 0.36, 0.08); f2.castShadow = true
        this.flag.add(f1, f2)
        this.flag.rotation.x = Math.PI / 2 - 0.15                                                       // down: lying along the box
        g.scene.add(group)
        g.objects.add(null, { type: 'fixed', friction: 0.5, colliders: [ { shape: 'cylinder', parameters: [ 0.75, 0.3 ], position: { x: this.position.x, y: this.position.y + 0.75, z: this.position.z } } ] })
        this.wobble = 0
    }

    setLetter()
    {
        const g = this.game, W = this.words, C = g.site.contact || {}
        const m = String(g.site.avatar || '').match(/github\.com\/([\w-]+)\.png/)
        const face = m ? `https://avatars.githubusercontent.com/${m[1]}?s=144` : ''
        const links = (C.links || []).filter(l => l.href && !/^mailto:/.test(l.href))
            .map(l => `<a class="l-link" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')
        this.el = document.createElement('div'); this.el.className = 'h-letter'; this.el.hidden = true
        this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-modal', 'true'); this.el.setAttribute('aria-labelledby', 'h-ltitle')
        this.el.innerHTML = `<div class="l-card"><i class="l-stripe"></i>
            <button type="button" class="h-x" data-close aria-label="${esc(W.close)}">×</button>
            ${face ? `<img class="l-face" src="${face}" alt="" width="72" height="72">` : ''}
            <h2 id="h-ltitle">${esc(W.title)}</h2>
            <div class="l-mail"><a href="mailto:${esc(C.email)}">${esc(C.email)}</a><button type="button" class="l-copy">${esc(W.copy)}</button></div>
            ${links ? `<div class="l-links">${links}</div>` : ''}</div>`
        document.getElementById('hud').appendChild(this.el)
        this.el.addEventListener('click', e => { if(e.target === this.el || e.target.closest('[data-close]')) this.close() })
        const copy = this.el.querySelector('.l-copy')
        copy.addEventListener('click', async () =>
        {
            try { await navigator.clipboard.writeText(C.email) } catch(e) {}
            copy.textContent = W.copied; clearTimeout(this.copyT); this.copyT = setTimeout(() => { copy.textContent = W.copy }, 1600)
        })
    }

    near(p) { return Math.hypot(p.x - this.position.x, p.z - this.position.z) < NEAR }

    open()
    {
        const g = this.game, now = performance.now()
        if(this.isOpen || now - this.last < 2500) return
        this.last = now
        this.wobble = 1
        g.sound && g.sound.tone({ type: 'triangle', f0: 880, d: 0.12, peak: 0.12 })
        g.sound && g.sound.tone({ type: 'triangle', f0: 1320, d: 0.25, peak: 0.1, delay: 0.1 })
        g.achievements && g.achievements.unlock && g.achievements.unlock('mail')
        this.back = document.activeElement
        setTimeout(() =>                                   // his 260 ms: the flag goes up first
        {
            this.isOpen = true
            this.el.hidden = false
            this.el.classList.remove('in'); void this.el.offsetWidth; this.el.classList.add('in')
            g.modes.lock(true)
            const x = this.el.querySelector('.h-x'); x && x.focus({ preventScroll: true })
        }, 260)
    }

    close()
    {
        if(!this.isOpen) return
        this.isOpen = false
        this.el.hidden = true
        this.game.modes.lock(false)
        this.back && this.back.focus && this.back.focus({ preventScroll: true })
    }

    update()
    {
        const g = this.game, dt = g.ticker.delta || 0.016
        // the truck bumping it opens the letter
        if(g.mode === 'drive' && !g.modes.locked)
        {
            const v = g.physicalVehicle.position
            if(Math.hypot(v.x - this.position.x, v.z - this.position.z) < 2.9 && g.physicalVehicle.speed > 1.5) this.open()
        }
        // the flag: up while the letter is open (and a moment after), down again later
        const up = this.isOpen || performance.now() - this.last < 4000
        const want = up ? 0 : Math.PI / 2 - 0.15
        this.flag.rotation.x += (want - this.flag.rotation.x) * Math.min(1, dt * 8)
        if(this.wobble > 0.001) { this.wobble *= Math.exp(- dt * 4); this.group.rotation.z = Math.sin(performance.now() * 0.03) * 0.12 * this.wobble }
        else this.group.rotation.z = 0
    }
}
