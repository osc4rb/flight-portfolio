/* Perf.js — keeps the frame rate up on slower GPUs. Once the island is revealed it times real frames for two seconds;
   if the median frame is slower than about 50 fps it renders fewer pixels (pixel ratio 1.5 → 1) and checks
   again. A hidden tab gets no frames, so nothing is judged there. */
import { Game } from '../engine/Game.js'

const SLOW = 20                     // ms: a median frame longer than this steps down
const STEPS = [ 1 ]                 // never below 1: lower blurs the world and its labels

export class Perf
{
    constructor()
    {
        this.game = Game.getInstance()
        this.steps = STEPS.filter(s => s < this.game.viewport.pixelRatio)
        this.game.reveal.then(() => setTimeout(() => this.sample(), 1500))
    }

    sample()
    {
        if(!this.steps.length) return
        if(document.hidden) { setTimeout(() => this.sample(), 2000); return }
        const times = []
        let last = performance.now()
        const end = last + 2000
        const frame = now => { times.push(now - last); last = now; now < end ? requestAnimationFrame(frame) : this.judge(times) }
        requestAnimationFrame(frame)
    }

    judge(times)
    {
        times.sort((a, b) => a - b)
        const median = times[times.length >> 1] || 0
        this.last = median
        if(median <= SLOW) return
        const v = this.game.viewport
        v.pixelRatioMax = this.steps.shift()
        v.measure()
        v.events.trigger('change')
        setTimeout(() => this.sample(), 1000)
    }
}
