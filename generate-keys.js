const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const vapidKeys = webpush.generateVAPIDKeys();
const keysPath = path.join(__dirname, 'vapid-keys.json');

fs.writeFileSync(keysPath, JSON.stringify(vapidKeys, null, 2));

console.log('Claves VAPID generadas y guardadas en vapid-keys.json:');
console.log('VAPID_PUBLIC_KEY=' + vapidKeys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + vapidKeys.privateKey);
