// Prints a new pair of VAPID keys for phone notifications.
// Run: npm run vapid-keys   (from the call-server folder)
// Put the two keys into the host's settings as VAPID_PUBLIC_KEY and
// VAPID_PRIVATE_KEY. Keep the private key secret; never commit it.
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log("VAPID_PUBLIC_KEY=" + publicKey);
console.log("VAPID_PRIVATE_KEY=" + privateKey);
console.log("VAPID_SUBJECT=mailto:you@example.com   (use your own email address)");
