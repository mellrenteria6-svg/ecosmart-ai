// Genera las claves de los avisos push (RF23) para pegarlas en Render como
// VAPID_PUBLICA y VAPID_PRIVADA. Se muestran solo en tu pantalla; no se guardan en ningún archivo.
// Uso: npm run nube:claves
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()
console.log('\nPega estas dos claves en Render (Environment):\n')
console.log(`VAPID_PUBLICA = ${publicKey}`)
console.log(`VAPID_PRIVADA = ${privateKey}`)
console.log('\nLa privada es secreta: no la compartas ni la subas a GitHub.\n')
