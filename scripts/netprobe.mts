/**
 * Probe whatever server is listening on :2567 and print the shape of the state
 * frames it sends, so it is obvious whether it is speaking the old full-snapshot
 * protocol or the new delta one.
 *
 *   npx tsx scripts/netprobe.mts
 */
import { Client } from '@colyseus/sdk';
import { pack } from 'msgpackr';

const room = new Client('ws://localhost:2567');
const bot = await room.joinOrCreate('game', { name: 'probe', difficulty: 'hard' });

let n = 0;
let bytes = 0;
bot.onMessage('state', (frame: any) => {
  const size = pack(frame).length;
  bytes += size;
  n++;
  if (n <= 3 || n % 40 === 0) {
    const keys = Object.keys(frame).join(',');
    const isDelta = 'v' in frame && 'st' in frame && !('enemies' in frame);
    console.log(`frame ${n}: ${size} B  ${isDelta ? 'DELTA' : 'FULL'}  keys=[${keys}]`);
    if (n === 1) console.log('  ', JSON.stringify(frame).slice(0, 220));
  }
});

const started = Date.now();
while (Date.now() - started < 8000) await new Promise((r) => setTimeout(r, 250));
const secs = (Date.now() - started) / 1000;
console.log(`\n${n} frames, ${bytes} B over ${secs.toFixed(1)}s = ${(bytes * 8 / 1000 / secs).toFixed(2)} kbit/s, `
  + `${Math.round(bytes / Math.max(1, n))} B/frame avg`);
bot.leave();
process.exit(0);
