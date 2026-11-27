/* Hud.js — the 2D layer over the world: back link, coin count, controls, the E prompt, résumé panels, toasts,
   the flight readout and a diagonal wipe for respawns. Words come from site.js; the panel shows a section's items
   the same way the résumé page does. */
import { Game } from '../engine/Game.js'

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

export class Hud
{
    constructor()
    {
        this.game = Game.getInstance()
        const S = this.game.site, nav = (S.world && S.world.nav) || {}, coarse = matchMedia('(pointer: coarse)').matches
        this.el = document.getElementById('hud')
        this.el.innerHTML = `
          <div class="h-top">
            <span class="h-chip h-coins" id="h-coins" hidden>● 0</span>
            <button type="button" class="h-btn h-right" id="h-ach" aria-expanded="false" title="Achievements">★ 0</button>
            <button type="button" class="h-btn h-ico" id="h-sound" aria-pressed="true" title="Sound (N)" aria-label="Sound"><svg viewBox='0 0 24 24' width='18' height='18' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M4 9v6h4l5 4V5L8 9z'/><path class='w' d='M16.5 8.5a5 5 0 0 1 0 7'/><path class='x' d='M16 9l5 6M21 9l-5 6'/></svg></button>
            <button type="button" class="h-btn h-ico" id="h-help" aria-expanded="false" title="Controls" aria-label="Controls">?</button>
            <button type="button" class="h-btn h-mapbtn" id="h-map" title="${esc(nav.mapTitle)}"><kbd>M</kbd>${esc(nav.map)}</button>
            <a class="h-btn h-cv" href="../index.html" title="${esc(nav.backTitle)}">${esc(nav.back)}</a>
          </div>
          <div class="h-help" id="h-helpbox" hidden>
            ${coarse ? `<p><b>Drag</b> the ring under you to move or drive. <b>Tap E</b> to get in, out, or talk.</p>`
                     : `<p><b>WASD</b> move · <b>Shift</b> run or boost · <b>Space</b> jump</p>
                        <p><b>E</b> get in or out, talk to people · <b>R</b> respawn · <b>H</b> honk · <b>M</b> map · <b>N</b> sound · <b>wheel</b> zoom · <b>drag</b> look around</p>
                        <p><b>Click</b> a person, the truck or the jet to walk over to it</p>
                        <p>In the jet: <b>W</b> roll and pull up · <b>S</b> push down · <b>A/D</b> bank · <b>Shift</b> afterburner · <b>B</b> brake</p>`}
            <p class="h-mute">Find the five people around the island: they hold the résumé. Coins are for fun.</p>
          </div>
          <div class="h-achbox" id="h-achbox" hidden></div>
          <div class="h-unlock" id="h-unlock" role="status" aria-live="polite"></div>
          <div class="h-bubble" id="h-bubble" aria-live="polite"><span id="h-btext"></span></div>
          <div class="h-prompt" id="h-prompt" hidden></div>
          <div class="h-flight" id="h-flight" hidden></div>
          <div class="h-race" id="h-race" hidden></div>
          <div class="h-toast" id="h-toast" role="status" aria-live="polite"></div>
          <div class="h-panel" id="h-panel" hidden role="dialog" aria-modal="true" aria-labelledby="h-ptitle"></div>
          <button type="button" class="h-btn h-deskback" id="h-deskback" hidden>← Back to the island <kbd>Esc</kbd></button>
          <div class="h-links" id="h-links" hidden></div>
          <div class="h-wipe" id="h-wipe"></div>`
        this.$ = id => document.getElementById(id)
        this.$('h-help').addEventListener('click', () => this.help(this.$('h-helpbox').hidden))
        this.$('h-ach').addEventListener('click', () => { const b = this.$('h-achbox'); b.hidden = !b.hidden; this.$('h-ach').setAttribute('aria-expanded', !b.hidden); if(!b.hidden) this.help(false) })
        this.$('h-map').addEventListener('click', () => this.game.map && (this.game.map.open ? this.game.map.close() : this.game.map.show()))
        this.$('h-sound').addEventListener('click', () => { this.game.sound.start(); this.game.sound.toggle() })
        this.sound(this.game.sound ? this.game.sound.muted : false)
        this.$('h-prompt').addEventListener('click', () => this.game.modes.interact())
        this.$('h-deskback').addEventListener('click', () => this.game.desk.leave())
        this.$('h-panel').addEventListener('click', e => { if(e.target.closest('[data-close]') || e.target.id === 'h-panel') this.closePanel() })
        addEventListener('keydown', e => { if(e.key === 'Escape' && !this.$('h-panel').hidden) this.closePanel() })
    }

    // nothing pops open at the start: the controls wait behind the ? button
    ready() {}

    help(on)
    {
        this.$('h-helpbox').hidden = !on
        this.$('h-help').setAttribute('aria-expanded', on)
    }

    prompt(text)
    {
        const p = this.$('h-prompt')
        if(!text) { p.hidden = true; this.promptText = null; return }
        if(text === this.promptText && !p.hidden) return
        this.promptText = text
        p.innerHTML = `<kbd>E</kbd>${esc(text)}`; p.hidden = false
        p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop')
        this.game.sound && this.game.sound.tick()
    }

    sound(muted)
    {
        const b = this.$('h-sound'); if(!b) return
        b.setAttribute('aria-pressed', !muted); b.classList.toggle('off', muted)
    }

    // a speech bubble over a person, typed out a letter at a time with their voice
    say(text, color, voice = 1)
    {
        const b = this.$('h-bubble'), t = this.$('h-btext')
        clearInterval(this.typeT)
        if(!text) { b.classList.remove('on'); return }
        b.style.setProperty('--c', color || 'var(--ac)')
        t.textContent = ''; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on')
        this.game.sound && this.game.sound.pop(true)
        let i = 0
        this.typeT = setInterval(() =>
        {
            i++; t.textContent = text.slice(0, i)
            const ch = text[i - 1]
            if(ch && /[a-z0-9]/i.test(ch) && i % 2) this.game.sound && this.game.sound.blip(voice, ch)
            if(i >= text.length) clearInterval(this.typeT)
        }, 26)
    }

    bubbleAt(x, y)
    {
        const b = this.$('h-bubble')
        if(x === null || x < - 0.1 || x > 1.1) { b.style.visibility = 'hidden'; return }
        b.style.visibility = ''
        const W = innerWidth, half = b.offsetWidth / 2 + 10, px = Math.min(W - half, Math.max(half, x * W))   // keep it on screen
        b.style.left = px.toFixed(1) + 'px'; b.style.top = (Math.max(0.12, y) * 100).toFixed(2) + '%'
    }

    toast(text, gold)
    {
        const t = this.$('h-toast'); t.textContent = text; t.classList.toggle('gold', !!gold); t.classList.add('on')
        clearTimeout(this.toastT); this.toastT = setTimeout(() => t.classList.remove('on'), 3600)
    }

    coins(got, total)
    {
        const c = this.$('h-coins'); c.hidden = false; c.textContent = `● ${got} / ${total}`
        c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop')
    }

    panel(section, color, back)
    {
        const p = this.$('h-panel'), ext = h => /^https?:/.test(h) ? ' target="_blank" rel="noopener"' : ''
        const items = (section.items || []).map(it => it.sub ? `<li class="sub">${esc(it.sub)}</li>`
            : `<li><span class="when">${esc(it.when || '')}</span><p>${it.href && !/^\?/.test(it.href) ? `<a href="${esc(it.href)}"${ext(it.href)}><b>${esc(it.lead)}</b></a>` : `<b>${esc(it.lead || '')}</b>`} ${md(it.text || '')}</p></li>`).join('')
        p.innerHTML = `<div class="h-card" style="--c:${color}"><header><h2 id="h-ptitle">${esc(section.title)}</h2><button type="button" class="h-x" data-close aria-label="Close">×</button></header>
          <ul${section.plain ? ' class="plain"' : ''}>${items}</ul><footer><a href="../index.html#${esc(section.id)}">Open on the résumé page</a><button type="button" class="h-btn" data-close>${esc(back || 'Back to the island')} <kbd>E</kbd></button></footer></div>`
        p.hidden = false
        p.classList.remove('in'); void p.offsetWidth; p.classList.add('in')
        this.game.sound && (this.game.sound.pop(true), this.game.sound.whoosh())
        this.say(null)
        this.game.modes.lock(true)
        const x = p.querySelector('.h-x'); if(x) x.focus({ preventScroll: true })
    }

    closePanel()
    {
        const p = this.$('h-panel'); if(p.hidden) return
        p.hidden = true
        const room = this.game.room
        if(room && room.state !== 'off') room.panelClosed(); else this.game.modes.lock(false)
        this.game.sound && this.game.sound.pop(false)
        const st = this.game.stations; if(st && st.talker) { st.talker.line++; st.talker = null }     // greet again with the next line
        this.game.canvasElement.focus && this.game.canvasElement.focus()
    }

    flight(s, agl)
    {
        const f = this.$('h-flight'); f.hidden = this.game.mode !== 'fly'
        f.innerHTML = `<span><b>${Math.round(s.v * 1.944 * 2)}</b> kt</span><span><b>${Math.max(0, Math.round(agl * 3.28 * 2))}</b> ft</span><span>THR <b>${Math.round(s.thr * 100)}</b>%</span>`
    }

    // the achievements count, the list, and a slide-in when one unlocks
    achievements(list, unlocked)
    {
        const n = list.filter(a => a.done).length
        this.$('h-ach').textContent = `★ ${n}/${list.length}`
        this.$('h-achbox').innerHTML = `<ul>${list.map(a => `<li class="${a.done ? 'done' : ''}"><span>${a.done ? '★' : '☆'}</span><p><b>${esc(a.title)}</b>${esc(a.how)}</p></li>`).join('')}</ul>`
        if(!unlocked) return
        const u = this.$('h-unlock'); u.innerHTML = `<span>★</span><p><small>Achievement</small><b>${esc(unlocked)}</b></p>`
        u.classList.remove('on'); void u.offsetWidth; u.classList.add('on')
        clearTimeout(this.unlockT); this.unlockT = setTimeout(() => u.classList.remove('on'), 3200)
        const c = this.$('h-ach'); c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop')
    }

    // the contact links from site.js, shown for a while (the blimp)
    links(list)
    {
        const el = this.$('h-links')
        el.innerHTML = list.map(l => `<a class="h-btn" href="${esc(l.href)}"${/^https?:/.test(l.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)}</a>`).join('')
        el.hidden = false; el.classList.remove('in'); void el.offsetWidth; el.classList.add('in')
        clearTimeout(this.linksT); this.linksT = setTimeout(() => { el.hidden = true }, 9000)
    }

    deskBack(on, text)
    {
        const b = this.$('h-deskback')
        if(this.deskBackText === undefined) this.deskBackText = b.innerHTML
        b.innerHTML = text ? `${esc(text)} <kbd>Esc</kbd>` : this.deskBackText
        b.hidden = !on
    }

    // the lap readout while flying: next gate, lap time, best time on this device
    race(r)
    {
        const el = this.$('h-race'); if(!el) return
        el.hidden = !r || this.game.mode !== 'fly'
        if(el.hidden) return
        const best = r.best ? ` · best <b>${r.best.toFixed(1)}</b> s` : ''
        el.innerHTML = r.time === undefined ? `Yellow ring starts the lap · ${r.n} gates${best}`
            : `Gate <b>${r.gate === 0 ? r.n : r.gate}</b>/${r.n} · <b>${r.time.toFixed(1)}</b> s${best}`
    }

    // diagonal wipe in, run the callback while the screen is covered, wipe out
    wipe(callback)
    {
        const w = this.$('h-wipe')
        if(w.classList.contains('in')) { callback && callback(); return true }
        w.classList.add('in')
        setTimeout(() => { try { callback && callback() } finally { setTimeout(() => w.classList.remove('in'), 120) } }, 380)
        return true
    }
}
