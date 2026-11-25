require('dotenv').config();
const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Cargar o generar claves VAPID
const keysFile = path.join(__dirname, 'vapid-keys.json');
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (!vapidPublicKey || !vapidPrivateKey) {
  if (fs.existsSync(keysFile)) {
    const saved = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
    vapidPublicKey = saved.publicKey;
    vapidPrivateKey = saved.privateKey;
  } else {
    const generated = webpush.generateVAPIDKeys();
    vapidPublicKey = generated.publicKey;
    vapidPrivateKey = generated.privateKey;
    fs.writeFileSync(keysFile, JSON.stringify(generated, null, 2));
    console.log('Se generaron nuevas claves VAPID en vapid-keys.json');
  }
}

const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@spacelaunches-pwa.local';
webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

// Almacenamiento de suscripciones (en memoria + respaldo en archivo local)
const subsFile = path.join(__dirname, 'subscriptions.json');
let subscriptions = [];

if (fs.existsSync(subsFile)) {
  try {
    subscriptions = JSON.parse(fs.readFileSync(subsFile, 'utf8'));
  } catch {
    subscriptions = [];
  }
}

function saveSubscriptions() {
  try {
    fs.writeFileSync(subsFile, JSON.stringify(subscriptions, null, 2));
  } catch (err) {
    console.warn('No se pudo persistir subscriptions.json:', err.message);
  }
}

app.get('/', (_req, res) => {
  res.json({
    service: 'Space Launches Push Notification Server',
    status: 'online',
    subscribers: subscriptions.length,
    publicKey: vapidPublicKey,
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, subscribers: subscriptions.length });
});

app.get('/api/vapid-public-key', (_req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

app.get('/api/subscriptions/count', (_req, res) => {
  res.json({ count: subscriptions.length });
});

// Registrar suscripción Push del cliente Angular (SwPush)
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'Objeto PushSubscription inválido' });
  }

  const exists = subscriptions.some((s) => s.endpoint === subscription.endpoint);
  if (!exists) {
    subscriptions.push(subscription);
    saveSubscriptions();
  }

  console.log(`Suscripción registrada. Total activas: ${subscriptions.length}`);
  res.status(201).json({
    message: 'Suscripción registrada correctamente',
    totalSubscribers: subscriptions.length,
  });
});

// Eliminar suscripción
app.post('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) {
    return res.status(400).json({ error: 'Falta el endpoint de suscripción' });
  }

  const before = subscriptions.length;
  subscriptions = subscriptions.filter((s) => s.endpoint !== endpoint);
  if (subscriptions.length !== before) {
    saveSubscriptions();
  }

  res.json({
    message: 'Suscripción eliminada',
    totalSubscribers: subscriptions.length,
  });
});

// Disparar notificación push a todos los clientes suscritos
app.post('/api/notify', async (req, res) => {
  if (subscriptions.length === 0) {
    return res.status(400).json({
      error: 'No hay dispositivos suscritos todavía. Activa las notificaciones en la PWA primero.',
    });
  }

  const {
    title = 'Alerta de Lanzamiento Espacial 🚀',
    body = 'Hay una nueva actualización de misión disponible.',
    url = '/',
    tag = 'launch-alert',
  } = req.body || {};

  // Formato compatible con @angular/service-worker (ngsw-worker.js)
  const payload = JSON.stringify({
    notification: {
      title,
      body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      vibrate: [150, 75, 150],
      tag,
      data: {
        onActionClick: {
          default: { operation: 'openWindow', url },
        },
      },
    },
  });

  const results = await Promise.allSettled(
    subscriptions.map((sub) => webpush.sendNotification(sub, payload))
  );

  // Limpiar suscripciones expiradas o revocadas (404 / 410)
  const validSubs = [];
  let sent = 0;
  let failed = 0;

  results.forEach((result, idx) => {
    if (result.status === 'fulfilled') {
      sent++;
      validSubs.push(subscriptions[idx]);
    } else {
      failed++;
      const statusCode = result.reason?.statusCode;
      if (statusCode !== 404 && statusCode !== 410) {
        validSubs.push(subscriptions[idx]);
      }
      console.warn('Error al enviar push:', result.reason?.message || result.reason);
    }
  });

  if (validSubs.length !== subscriptions.length) {
    subscriptions = validSubs;
    saveSubscriptions();
  }

  res.json({
    message: `Notificación enviada (${sent} exitosas, ${failed} fallidas)`,
    sent,
    failed,
    totalSubscribers: subscriptions.length,
  });
});

app.listen(PORT, () => {
  console.log(`Servidor Push escuchando en http://localhost:${PORT}`);
  console.log(`VAPID Public Key: ${vapidPublicKey}`);
});
