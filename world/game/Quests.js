/* Quests.js — a short chain of things to do, told as messages from Oscar in a Messenger-style thread at the top
   left: his avatar and name, a typing indicator, then the message; a tick when it is done, then the next one.
   The words are in site.js → world; each step ends when its `goal` achievement unlocks (Achievements.js). */
import { Game } from '../engine/Game.js'

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export class Quests
{
    constructor()
    {
        this.game = Game.getInstance()
        const W = this.game.site.world || {}
        this.list = W.quests || []
        this.from = W.from || ''
        this.doneText = W.done || ''
        if(!this.list.length) return
        const m = String(this.game.site.avatar || '').match(/github\.com\/([\w-]+)\.png/)
        const face = m ? `https://avatars.githubusercontent.com/${m[1]}?s=64` : ''

        this.el = document.createElement('div'); this.el.className = 'h-msgs'
        this.el.innerHTML = `<button type="button" class="h-msghead" aria-expanded="true">${face ? `<img src="${esc(face)}" alt="" width="22" height="22">` : ''}<b>${esc(this.from)}</b><i class="h-unread" hidden></i></button><ol class="h-thread" aria-live="polite"></ol>`
        document.getElementById('hud').appendChild(this.el)
        this.thread = this.el.querySelector('.h-thread')
        this.el.querySelector('.h-msghead').addEventListener('click', () => this.toggle())
        this.step = this.list.findIndex(q => !this.isDone(q.goal))
        // the first message once the world is up; nothing if every step is already done on this device
        if(this.step >= 0) this.game.reveal.then(() => setTimeout(() => this.say(this.list[this.step].text), 1500))
        else this.el.hidden = true
    }

    isDone(id) { return this.game.achievements && this.game.achievements.done.has(id) }

    toggle(open = this.el.classList.contains('closed'))
    {
        this.el.classList.toggle('closed', !open)
        this.el.querySelector('.h-msghead').setAttribute('aria-expanded', open)
        if(open) this.el.querySelector('.h-unread').hidden = true
    }

    // typing dots for a moment, then the message; only the last three stay in view
    say(text, done = false)
    {
        const typing = document.createElement('li'); typing.className = 'typing'; typing.innerHTML = '<span></span><span></span><span></span>'
        this.thread.appendChild(typing)
        setTimeout(() =>
        {
            typing.remove()
            const li = document.createElement('li'); li.textContent = text
            if(done) li.classList.add('last')
            this.thread.appendChild(li)
            while(this.thread.children.length > 3) this.thread.firstElementChild.remove()
            this.current = li
            const g = this.game
            g.sound && g.sound.pop(true)
            if(this.el.classList.contains('closed')) this.el.querySelector('.h-unread').hidden = false
        }, Math.min(1600, 500 + text.length * 12))
    }

    // Achievements.unlock calls this: finishing the current step ticks its message and brings the next one
    onUnlock(id)
    {
        if(!this.el || this.step < 0 || this.step >= this.list.length || this.list[this.step].goal !== id) return
        if(this.current) this.current.classList.add('ok')
        this.step = this.list.findIndex((q, i) => i > this.step && !this.isDone(q.goal))
        setTimeout(() => this.step >= 0 ? this.say(this.list[this.step].text) : this.doneText && this.say(this.doneText, true), 1400)
    }
}
