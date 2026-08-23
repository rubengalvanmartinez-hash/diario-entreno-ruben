// Test de humo de Supabase Realtime Broadcast: dos clientes en el mismo canal, mide latencia.
// Ejecutar: node test-realtime.mjs
import { createClient } from '@supabase/supabase-js'

const URL = 'https://fxhkzstvxljlohrlgyyc.supabase.co'
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4aGt6c3R2eGxqbG9ocmxneXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MzA1OTMsImV4cCI6MjA5MTQwNjU5M30.BHoDE8V0ZLclkvSBdrFkAeqCQAkHW1j3IxzwchJh9B8'

const a = createClient(URL, KEY)
const b = createClient(URL, KEY)
const CANAL = 'sesion-activa:test-claude'

const chB = b.channel(CANAL, { config: { broadcast: { self: false } } })
const recibidos = []
chB.on('broadcast', { event: 'op' }, ({ payload }) => {
  recibidos.push({ ...payload, latenciaMs: Date.now() - payload.ts })
})
await new Promise((res, rej) => {
  chB.subscribe((status, err) => { console.log('B:', status, err ?? ''); if (status === 'SUBSCRIBED') res(); if (status === 'CHANNEL_ERROR') rej(err) })
})

const chA = a.channel(CANAL, { config: { broadcast: { self: false } } })
await new Promise((res, rej) => {
  chA.subscribe((status, err) => { console.log('A:', status, err ?? ''); if (status === 'SUBSCRIBED') res(); if (status === 'CHANNEL_ERROR') rej(err) })
})

for (let i = 1; i <= 5; i++) {
  await chA.send({ type: 'broadcast', event: 'op', payload: { n: i, t: 'serie', campo: 'reps', valor: 10 + i, ts: Date.now() } })
  await new Promise((r) => setTimeout(r, 150))
}
await new Promise((r) => setTimeout(r, 800))
console.log('Recibidos en B:', recibidos.length, 'de 5')
for (const r of recibidos) console.log(`  op ${r.n}: reps=${r.valor}  latencia ≈ ${r.latenciaMs} ms`)
await a.removeAllChannels(); await b.removeAllChannels()
process.exit(recibidos.length === 5 ? 0 : 1)
