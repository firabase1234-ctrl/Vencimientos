const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();

const ART = new Date(Date.now() - 3 * 3600e3);
const today = ART.toISOString().slice(0, 10), hour = ART.getUTCHours();
const NAMES = { vtv: 'VTV', seguro: 'Seguro', patente: 'Patente', service: 'Service' };
const dleft = s => Math.round((Date.parse(s) - Date.parse(today)) / 864e5);

(async () => {
  const users = await db.collection('users').get();
  for (const u of users.docs) {
    const d = u.data(), tokens = d.fcmTokens || [];
    if (!tokens.length || d.lastSentDate === today || hour < (d.reminderHour ?? 9)) continue;

    const vs = await u.ref.collection('vehicles').get(), msgs = [];
    vs.forEach(v => {
      const x = v.data();
      for (const k in (x.due || {})) {
        const n = dleft(x.due[k]);
        if ([30, 7, 1].includes(n)) {
          const nm = k === 'custom' ? (x.customName || 'Personalizado') : NAMES[k];
          msgs.push(`${nm} de ${x.alias || x.plate}: ${n === 1 ? 'vence mañana' : 'vence en ' + n + ' días'}`);
        }
      }
    });

    if (msgs.length) {
      const r = await admin.messaging().sendEachForMulticast({
        tokens, notification: { title: 'Vencimientos', body: msgs.join('\n') }
      });
      const bad = tokens.filter((t, i) => !r.responses[i].success &&
        /not-registered|invalid-argument/.test(r.responses[i].error.code));
      if (bad.length) await u.ref.update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...bad) });
    }
    await u.ref.update({ lastSentDate: today });
  }
  console.log('Listo', today, hour);
})().catch(e => { console.error(e); process.exit(1); });
