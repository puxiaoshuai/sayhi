const mongoose = require('mongoose');
(async () => {
  await mongoose.connect('mongodb://localhost:27018/sayhi');
  const db = mongoose.connection.db;
  const cols = (await db.listCollections().toArray()).map(c => c.name);
  console.log('collections:', cols.join(', '));
  const favs = await db.collection('favorites').find({}).toArray();
  for (const f of favs) console.log('FAV', JSON.stringify(f.translation), 'codes:', JSON.stringify(f.translation));
  const scenes = await db.collection('scenes').find({}).toArray().catch(()=>[]);
  console.log('scenes:', scenes.length);
  for (const s of scenes) {
    for (const w of (s.words||[])) console.log('SCENE_WORD', JSON.stringify(w.en || w.word));
    for (const e of (s.expressions||[])) console.log('SCENE_EXPR', JSON.stringify(e.en));
  }
  await mongoose.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
