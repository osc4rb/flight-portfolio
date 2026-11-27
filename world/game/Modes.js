/* Modes.js — who you control: on foot, in the car, or in the jet. E (or Enter / the touch button) gets in, gets
   out, or talks to a résumé keeper; R respawns; Esc closes the panel. */
import * as THREE from 'three/webgpu'
import { Game } from '../engine/Game.js'

export class Modes
{
    constructor()
    {
        this.game = Game.getInstance()
        this.locked = false
        // while a résumé panel is open the input filter is 'modal', which mutes folio-2025's own actions (interact
        // included), so closing gets its own action in that category
        this.game.inputs.addActions([ { name: 'close', categories: [ 'modal' ], keys: [ 'Keyboard.Escape', 'Keyboard.KeyE', 'Keyboard.Enter', 'Gamepad.circle', 'Gamepad.cross' ] } ])

        this.game.inputs.events.on('interact', (action) => { if(action.active) this.interact() })
        this.game.inputs.interactiveButtons.events.on('interact', () => this.interact())
        this.game.inputs.events.on('close', (action) => { if(action.active && this.locked && performance.now() - this.lockedAt > 250) this.close() })
        // R: folio-2025's Player respawns the car; on foot or in the jet we handle it here
        this.game.inputs.events.on('respawn', (action) =>
        {
            if(!action.active || this.locked) return
            if(this.game.mode === 'foot') this.game.hud.wipe(() => this.game.walker.moveTo(this.game.respawns.getDefault().position.clone()))
            if(this.game.mode === 'fly') this.game.jet.crash('Respawn')
        })
        this.game.ticker.events.on('tick', () => this.update(), 7.5)
    }

    start()
    {
        const j = this.game.juice
        j.addTarget(this.game.carVisual.group, 'truck', () => this.interact())
        j.addTarget(this.game.jet.group, 'jet', () => this.interact())
        j.addTarget(this.game.desk.group, 'computer', () => this.game.desk.use())
        j.addTarget(this.game.sky.blimp, 'blimp', () => this.game.sky.showLinks())
        this.game.mode = 'foot'
        // you start in the opening disc between the jet and the computer (Desk.js SPOT), facing the camera
        this.game.walker.moveTo(this.game.jet.door.add(new THREE.Vector3(2.5, 1.2, 3.6)), Math.PI * 0.75)
        this.game.walker.setActive(true)
        this.game.reveal.then(() => this.game.hud.ready())
        this.refreshPrompt()
    }

    activePosition()
    {
        if(this.game.mode === 'drive') return this.game.physicalVehicle.position
        if(this.game.mode === 'fly') return this.game.jet.position
        return this.game.walker.position
    }

    // what E does right now
    action()
    {
        const g = this.game, st = g.stations && g.stations.near
        if(this.locked) return null
        if(g.mode === 'foot')
        {
            if(st) return { label: 'Talk · ' + st.section.title, run: () => g.stations.open(st) }
            const p = g.walker.position
            if(p.distanceTo(g.physicalVehicle.position) < 4) return { label: 'Drive the truck', run: () => this.enter('drive') }
            if(p.distanceTo(g.jet.door) < 5 && g.jet.state.ground) return { label: 'Fly the jet', run: () => this.enter('fly') }
            if(p.distanceTo(g.desk.front) < 3.5) return { label: 'Use the computer', run: () => g.desk.use() }
        }
        if(g.mode === 'drive')
        {
            if(st && g.physicalVehicle.speed < 3) return { label: 'Read · ' + st.section.title, run: () => g.stations.open(st) }
            if(g.physicalVehicle.speed < 3) return { label: 'Get out', run: () => this.leave('drive') }
        }
        if(g.mode === 'fly')
            return g.jet.state.ground && g.jet.state.v < 3 ? { label: 'Climb out', run: () => this.leave('fly') } : { label: 'Bail out', run: () => this.leave('fly', false, true) }
        return null
    }

    interact()
    {
        if(performance.now() - (this.lockedAt || 0) < 250) return          // the key that just opened or closed a panel
        if(this.locked) { this.close(); return }
        const a = this.action(); if(a) a.run()
    }

    close() { if(this.game.course && this.game.course.result) this.game.course.closeResult(); else if(this.game.map && this.game.map.open) this.game.map.close(); else if(this.desk) this.desk.leave(); else this.game.hud.closePanel() }

    enter(mode)
    {
        const g = this.game
        g.walker.setActive(false)
        g.mode = mode
        g.sound.pop(true); g.juice.dust(g.walker.feet(), 5, { size: 0.4 })
        if(mode === 'drive') { g.player.state = 1; g.carVisual.squash.kick(- 5); g.hud.toast('W/S drive · A/D steer · Shift boost · Space jump · E gets out') }
        if(mode === 'fly') { g.jet.enter(); g.cameraOverride = (cam) => g.jet.camera(cam); this.far(true) }
        this.refreshPrompt()
    }

    leave(mode, instant = false, bail = false)
    {
        const g = this.game
        let spot
        if(mode === 'drive')
        {
            const v = g.physicalVehicle
            spot = v.position.clone().add(new THREE.Vector3(0, 0, 2.6).applyQuaternion(v.quaternion)); spot.y = v.position.y + 1
        }
        else
        {
            spot = bail ? g.jet.position.clone().add(new THREE.Vector3(0, - 3, 0)) : g.jet.door.add(new THREE.Vector3(0, 1.2, 0))
            g.jet.exit(); g.cameraOverride = null; this.far(false)
            if(bail) g.jet.crash('Ejected')
        }
        if(instant) spot = g.jet.door.add(new THREE.Vector3(0, 1.2, 0))
        g.mode = 'foot'
        g.walker.setActive(true)
        g.walker.moveTo(spot)
        this.refreshPrompt()
    }

    far(on)
    {
        const v = this.game.view
        for(const cam of [ v.camera, v.defaultCamera ]) { cam.far = on ? 1400 : 200; cam.updateProjectionMatrix() }
        this.game.look.flight(on)
    }

    lock(on)
    {
        this.locked = on
        this.lockedAt = performance.now()
        const f = this.game.inputs.filters
        f.clear(); f.add(on ? 'modal' : 'wandering')
        this.refreshPrompt()
    }

    refreshPrompt()
    {
        const a = this.action()
        this.game.hud.prompt(a ? a.label : null)
        const b = this.game.inputs.interactiveButtons
        if(a) b.addItems([ 'interact' ]); else b.removeItems([ 'interact' ])
    }

    update()
    {
        this.tick = (this.tick || 0) + 1
        if(this.tick % 10 === 0) this.refreshPrompt()
        if(this.game.mode !== 'fly') this.game.hud.$('h-flight').hidden = true
        else this.game.hud.flight(this.game.jet.state, this.game.jet.position.y - Math.max(0, this.game.stage.height(this.game.jet.position.x, this.game.jet.position.z)))
    }
}
