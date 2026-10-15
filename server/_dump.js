const mongoose = require('mongoose');
(async () => {
  await mongoose.connect('mongodb://localhost:27018/sayhi');
  const favs = await mongoose.connection.db.collection('favorites').find({}).limit(50).toArray();
  console.log('favorites count sample:', favs.length);
  for (const f of favs) console.log(JSON.stringify({ t: f.translation, src: f.sourceType }));
  await mongoose.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
