const mongoose = require('mongoose');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const sha = (s) => createHash('sha1').update(s).digest('hex');
const MODEL = 'qwen-audio-3.1-tts-flash';
const VOICES = ['Andy_v3.1','Brian_v3.1','David_v3.1','Abby_v3.1','Annie_v3.1','Ava_v3.1','Beth_v3.1','Betty_v3.1','Cally_v3.1','Cindy_v3.1','Donna_v3.1','Emily_v3.1','Luna_v3.1','Eric_v3.1','Luca_v3.1'];

(async () => {
  const files = [];
  const root = path.resolve('./tts-cache');
  for (const shard of fs.readdirSync(root)) {
    const sub = path.join(root, shard);
    if (!fs.statSync(sub).isDirectory()) continue;
    for (const n of fs.readdirSync(sub)) files.push(n.replace(/\.mp3$/, ''));
  }
  console.log('cache keys:', files.length);

  await mongoose.connect('mongodb://localhost:27018/sayhi');
  const db = mongoose.connection.db;
  const texts = new Set();
  for (const f of await db.collection('favorites').find({}).toArray()) texts.add(f.translation);
  for (const s of await db.collection('scenes').find({}).toArray()) {
    for (const w of (s.words || [])) { if (w.en || w.word) texts.add(w.en || w.word); }
    for (const e of (s.expressions || [])) if (e.en) texts.add(e.en);
    if (s.title) texts.add(s.title);
  }
  console.log('corpus:', texts.size);

  const found = new Map();
  for (const t of texts) for (const v of VOICES) {
    const k = sha([MODEL, v, 1, 'mp3', t].join('|'));
    if (files.includes(k)) found.set(k, { t, v });
  }
  for (const k of files) console.log(k, '=>', found.has(k) ? JSON.stringify(found.get(k)) : '*** UNMATCHED ***');
  await mongoose.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
