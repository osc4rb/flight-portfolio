/* Achievements.js — small goals across the world, after folio-2025's achievements (his AchievementsArea and the
   unlock toasts). Kept in localStorage on this device only. Other modules call `game.achievements.unlock(id)`;
   the HUD shows a count and a list. */
import { Game } from '../engine/Game.js'

const KEY = 'world-achievements'
export const ACHIEVEMENTS = [
    [ 'takeoff', 'Wheels up', 'Take off in the jet' ],
    [ 'lap', 'Full lap', 'Fly a whole lap of the gates' ],
    [ 'fast', 'Under 25 s', 'Fly a lap in under 25 seconds' ],
    [ 'tunnel', 'Through the mountain', 'Fly the tunnel' ],
    [ 'arches', 'Threading', 'Fly through all three arches' ],
    [ 'near', 'Close call', 'Pass within a few metres of rock' ],
    [ 'land', 'Greaser', 'Land back on the runway' ],
    [ 'splash', 'Splashdown', 'Put the jet in the sea' ],
    [ 'computer', 'Screen in a screen', 'Read the résumé at the desk' ],
    [ 'room', 'House call', 'Go into the cabin' ],
    [ 'mail', 'Mail call', 'Open the mailbox' ],
    [ 'explorer', 'Explorer', 'Find the cabin and all three doors' ],
    [ 'glide', 'Soft landing', 'Glide down after bailing out' ],
    [ 'people', 'Met everyone', 'Talk to all five people' ],
    [ 'coins', 'Coin collector', 'Pick up every coin' ],
    [ 'letters', 'Bowled over', 'Knock over a letter of the name' ],
    [ 'crates', 'Kaboom', 'Set off an explosive crate' ],
    [ 'podium', 'Podium', 'Land and stop after a lap' ],
    [ 'blimp', 'Hello up there', 'Fly close to the blimp' ],
    [ 'secret', 'Crowned', 'Find the secret ring' ],
    [ 'flip', 'Stunt driver', 'Flip the truck' ],
    [ 'honk', 'Beep beep', 'Honk the truck horn (H)' ],
]

export class Achievements
{
    constructor()
    {
        this.game = Game.getInstance()
        try { this.done = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')) } catch(e) { this.done = new Set() }
        this.groups = new Map()                             // folio-2025's Player reads this; we keep no progress groups
        this.game.hud.achievements(this.list())
    }

    list() { return ACHIEVEMENTS.map(([ id, title, how ]) => ({ id, title, how, done: this.done.has(id) })) }

    unlock(id)
    {
        if(this.done.has(id) || !ACHIEVEMENTS.some(a => a[0] === id)) return false
        this.done.add(id)
        localStorage.setItem(KEY, JSON.stringify([ ...this.done ]))
        const [ , title ] = ACHIEVEMENTS.find(a => a[0] === id)
        const g = this.game
        g.hud.achievements(this.list(), title)
        g.sound && g.sound.chime()
        g.quests && g.quests.onUnlock(id)
        return true
    }

    // folio-2025's Player reports truck stunts through his achievements API: map the ones we keep
    setProgress(name) { if(name === 'frontFlip' || name === 'backFlip' || name === 'upsideDown') this.unlock('flip') }
    addProgress(name) { if(name === 'honk') this.unlock('honk') }
}
