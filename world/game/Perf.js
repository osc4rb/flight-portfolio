/* Perf.js — keeps the frame rate up on slower GPUs. Once the island is revealed it times real frames for two seconds;
   if the median frame is slower than about 50 fps it takes the next step down and checks again:
   1. fewer pixels (pixel ratio 1.5 → 1; never below 1, which blurs the world and its labels)
   2. no edge blur, a smaller shadow map
   3. a lighter bloom
   A hidden tab gets no frames, so nothing is judged there. */
import { Game } from '../engine/Game.js'

const SLOW = 20                     // ms: a median frame longer than this steps down

export class Perf
{
    constructor()
    {
        this.game = Game.getInstance()
        this.level = 0
        this.steps = []
        if(this.game.viewport.pixelRatio > 1) this.steps.push(() => this.pixels(1))
        this.steps.push(() => this.blur(), () => this.bloom())
        this.game.reveal.then(() => setTimeout(() => this.sample(), 1500))
    }

    pixels(ratio)
    {
        const v = this.game.viewport
        v.pixelRatioMax = ratio
        v.measure()
        v.events.trigger('change')
    }

    blur()
    {
        const r = this.game.rendering
        r.postProcessing.outputNode = r.scenePassColor.add(r.bloomPass)
        r.postProcessing.needsUpdate = true
        const sun = this.game.stage.sun
        sun.shadow.mapSize.set(1024, 1024)
    }

    bloom()
    {
        const r = this.game.rendering
        r.postProcessing.outputNode = r.scenePassColor
        r.postProcessing.needsUpdate = true
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
        this.steps.shift()()
        this.level++
        setTimeout(() => this.sample(), 1000)
    }
}
