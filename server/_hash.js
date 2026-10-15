const { createHash } = require('crypto');
const sha = (s) => createHash('sha1').update(s).digest('hex');
const MODEL = 'qwen-audio-3.1-tts-flash';
const voices = ['Andy_v3.1','Brian_v3.1','David_v3.1','Abby_v3.1','Annie_v3.1','Ava_v3.1','Beth_v3.1','Betty_v3.1','Cally_v3.1','Cindy_v3.1','Donna_v3.1','Emily_v3.1','Luna_v3.1','Eric_v3.1','Luca_v3.1'];
const texts = [
  'television',
  'remote control',
  "The weather is really nice today, don't you think?",
  'The weather is really nice today, don’t you think?',
];
const files = ['4bb25dd2bf05da9d0d60a6278819d0dfc6ce76f0','d6559da4a879d2fa29077ca106ffb1f64709e6fc','de8f8b34e14b13df337810457cf7156cfdc7b8de','fbcd250884ffc07f0891a647f169557b512422b3'];
for (const t of texts) for (const v of voices) {
  const k = sha([MODEL, v, 1, 'mp3', t].join('|'));
  if (files.includes(k)) console.log('MATCH!', JSON.stringify(t), '=>', v, k);
}
console.log('done');
