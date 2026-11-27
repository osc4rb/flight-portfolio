/* Game.js — our replacement for folio-2025's Game.js (Bruno Simon, MIT; see LICENSE-folio-2025.md).
   The engine modules in this folder are his, copied as-is apart from the small patches listed in world/README.md;
   they all call Game.getInstance(), so this file gives them the members they expect. Systems we did not bring over
   (his audio, achievements, tracks, weather, water...) are small stubs here. Our own world lives in ../game/. */
import './threejs-override.js'
import * as THREE from 'three/webgpu'
import RAPIER from '@dimforge/rapier3d-compat'
import { Events } from './Events.js'
import { Ticker } from './Ticker.js'
import { Time } from './Time.js'
import { Viewport } from './Viewport.js'
import { Inputs } from './Inputs/Inputs.js'
import { Rendering } from './Rendering.js'
import { View } from './View.js'
import { Objects } from './Objects.js'
import { Physics } from './Physics/Physics.js'
import { PhysicsVehicle } from './Physics/PhysicsVehicle.js'
import { Player } from './Player.js'
import { Stage } from '../game/Stage.js'
import { CarVisual } from '../game/CarVisual.js'
import { Walker } from '../game/Walker.js'
import { Jet } from '../game/Jet.js'
import { Course } from '../game/Course.js'
import { Desk } from '../game/Desk.js'
import { Room } from '../game/Room.js'
import { Achievements } from '../game/Achievements.js'
import { Letters } from '../game/Letters.js'
import { Sky } from '../game/Sky.js'
import { Quests } from '../game/Quests.js'
import { Stations } from '../game/Stations.js'
import { Modes } from '../game/Modes.js'
import { Hud } from '../game/Hud.js'
import { Sound } from '../game/Sound.js'
import { Juice } from '../game/Juice.js'
import { Grass } from '../game/Grass.js'
import { Look } from '../game/Look.js'
import { Ambience } from '../game/Ambience.js'
import { Reveal } from '../game/Reveal.js'
import { Places } from '../game/Places.js'
import { IslandMap } from '../game/Map.js'
import { Perf } from '../game/Perf.js'

const noop = () => {}
const sound = { play: noop, playRandomNext: noop, stop: noop, volume: 0 }

export class Game
{
    static getInstance()
    {
        return Game.instance
    }

    constructor(options = {})
    {
        if(Game.instance)
            return Game.instance

        Game.instance = this
        this.options = options
        this.ready = this.init()
    }

    async init()
    {
        const report = this.options.onProgress || noop
        const progress = (k, what) => { this.reveal && this.reveal.progress && this.reveal.progress(k); report(k, what) }
        this.site = window.FLIGHT_SITE || {}
        this.domElement = document.querySelector('.game')
        this.canvasElement = this.domElement.querySelector('.js-canvas')
        this.scene = new THREE.Scene()
        this.mode = 'foot'                         // foot | drive | fly (ours: who the player controls)

        // stubs for folio-2025 systems we did not port
        this.debug = { active: false }
        this.quality = { level: matchMedia('(pointer: coarse)').matches ? 1 : 0, events: new Events() }
        // folio-2025's vehicle reports hits through this group: ours turns them into sound, dust, shake and wobble
        this.audio = { register: () => sound, groups: new Map([[ 'hitDefault', { ...sound, playRandomNext: (force, position) => this.juice && this.juice.impact(force, position) } ]]) }
        this.achievements = { setProgress: noop, addProgress: noop, groups: new Map() }
        this.tracks = { focusPoint: { set: noop } }
        this.dayCycles = { duration: 1e9 }
        this.water = { surfaceElevation: - 0.4, depthElevation: - 25 }
        this.world = { waterSurface: null }
        this.materials = { updateObject: noop }
        this.overlay = {
            show: (callback) => { this.hud && this.hud.wipe(callback) || (callback && callback()) },
            hide: noop
        }

        progress(0.05, 'engine')
        this.ticker = new Ticker()
        this.time = new Time()
        this.viewport = new Viewport(this.domElement)
        this.inputs = new Inputs([], [ 'wandering' ])
        this.rendering = new Rendering()
        await this.rendering.setRenderer()

        progress(0.15, 'physics')
        await RAPIER.init()
        this.RAPIER = RAPIER

        this.stage = new Stage()                   // respawns first: the view and player read them
        this.respawns = this.stage.respawns
        this.view = new View()
        if(!this.debug.active) this.scene.remove(this.view.cameraHelper)   // his debug-only helper: NaN while the viewport has no size
        this.rendering.setPostprocessing()
        this.rendering.start()
        this.reveal = new Reveal()                 // the opening: the ring and grid show now, the world loads behind them
        this.reveal.boot && this.reveal.boot()     // guarded: a cached older Reveal.js has no boot
        this.objects = new Objects()
        this.physics = new Physics()

        await this.stage.build((k) => progress(0.2 + k * 0.7, 'world'))
        this.sound = new Sound()
        this.juice = new Juice()
        this.grass = new Grass()
        for(const t of this.stage.trees.list) this.juice.addWobbler({ kind: 'tree', ...t })
        for(const h of this.stage.houses) this.juice.addWobbler({ kind: 'squash', obj: h.obj, base: h.obj.scale.x, x: h.x, z: h.z, r: h.r, y: 0, s: 1 })

        this.physicalVehicle = new PhysicsVehicle()
        this.player = new Player()
        this.hud = new Hud()
        this.achievements = new Achievements()     // small goals, kept on this device
        this.carVisual = new CarVisual()
        this.walker = new Walker()
        this.jet = new Jet()
        this.course = new Course()                 // peaks, arches, a tunnel and a timed lap of gates
        this.desk = new Desk()                     // the computer by the airstrip: the résumé on its screen
        this.room = new Room()                     // the cabin by the start, the room under the island, the doors to the other sites
        this.letters = new Letters()               // the name in big blocks you can knock over
        this.sky = new Sky()                       // the blimp with the links, and the secret ring
        this.look = new Look()                     // folio-2025's lighting, fog and materials, our colours
        this.look.convert()
        this.stage.water.material = this.look.waterMaterial()
        this.grass.mesh.material = this.look.grassMaterial(this.grass)
        this.stations = new Stations()
        this.grass.setMap()                        // again, now that the station houses stand
        this.ambience = new Ambience()
        this.modes = new Modes()
        this.quests = new Quests()                 // messages from Oscar: one thing to do at a time
        this.places = new Places()                 // labels over the places, and an arrow toward the current quest
        this.map = new IslandMap()                 // M: the island from above; click a place to go there
        this.perf = new Perf()                     // fewer pixels if the frame rate is low
        this.physicalVehicle.steeringAmplitude = 0.62   // his 0.5: the truck turns a little sharper

        this.modes.start()
        this.reveal.mask()                         // the few materials that are not MeshDefaultMaterial
        // compile every shader now, behind the loader, so nothing hitches the first time it comes into view
        progress(0.95, 'shaders')
        const t = performance.now()
        const every = this.view.camera.clone(); every.layers.enableAll()           // the camera only sees the ring while loading
        try { await this.rendering.renderer.compileAsync(this.scene, every) } catch(e) { console.warn('compile', e) }
        this.compileMs = Math.round(performance.now() - t)
        progress(1, 'ready')
        this.reveal.start(this.walker.position.clone().add({ x: - 2, y: 0, z: - 1.8 }))  // the disc: you, the desk and the jet's cockpit
    }
}
