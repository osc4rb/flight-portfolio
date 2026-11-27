/* Leaderboard.js — the shared lap board. Laps go to a Supabase table (tools/supabase/laps.sql) through its REST API
   with the project's public anon key; the table only allows reading and adding. With no project set in site.js →
   world.leaderboard, `on` is false and the race keeps its best times on this device only. */
import { Game } from '../engine/Game.js'

const NAME = 'world-race-name'

export class Leaderboard
{
    constructor()
    {
        const L = (Game.getInstance().site.world || {}).leaderboard || {}
        this.url = String(L.url || '').replace(/\/+$/, '')
        this.key = L.key || ''
        this.on = !!(this.url && this.key)
    }

    get name() { return localStorage.getItem(NAME) || '' }
    set name(v) { localStorage.setItem(NAME, v) }

    headers(extra = {}) { return { apikey: this.key, Authorization: 'Bearer ' + this.key, ...extra } }

    // the fastest laps, fastest first: [{ name, time }]
    async top(n = 10)
    {
        if(!this.on) return null
        try
        {
            const r = await fetch(`${this.url}/rest/v1/laps?select=name,time&order=time.asc&limit=${n}`, { headers: this.headers() })
            return r.ok ? (await r.json()).map(x => ({ name: x.name, time: +x.time })) : null
        }
        catch(e) { return null }
    }

    // post a lap; true when the board took it
    async post(name, time)
    {
        if(!this.on) return false
        name = String(name).replace(/[^A-Za-z0-9 ._'-]/g, '').trim().slice(0, 16)
        if(!name || !(time >= 15 && time <= 900)) return false
        this.name = name
        try
        {
            const r = await fetch(`${this.url}/rest/v1/laps`, { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify({ name, time: +time.toFixed(2) }) })
            return r.ok
        }
        catch(e) { return false }
    }
}
