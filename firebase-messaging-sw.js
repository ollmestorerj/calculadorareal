// Firebase Messaging Service Worker — RealEcom
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAv4knEI4IgKH6fRpr_3BuiuijvP2Ul2ms",
  authDomain: "calculadora-real-ecom.firebaseapp.com",
  projectId: "calculadora-real-ecom",
  storageBucket: "calculadora-real-ecom.firebasestorage.app",
  messagingSenderId: "845239286688",
  appId: "1:845239286688:web:71018a44cabee0025842c5"
});

const messaging = firebase.messaging();

// Recebe mensagens em background e mostra notificação
messaging.onBackgroundMessage(payload => {
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || 'RealEcom', {
    body: body || '',
    icon: icon || '/logcon.png',
    badge: '/logcon.png',
    tag: payload.data?.tag || 'realecom',
    data: payload.data || {}
  });
});

// Ao clicar na notificação, abre o app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('calculadorarealecom') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('https://calculadorarealecom.com.br');
    })
  );
});

// Agenda notificações locais via setTimeout (para notificações no mesmo dia)
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SCHEDULE_NOTIFICATION') {
    const { delay, title, body, tag } = event.data;
    setTimeout(() => {
      self.registration.showNotification(title, {
        body,
        icon: '/logcon.png',
        badge: '/logcon.png',
        tag: tag || 'realecom-event'
      });
    }, delay);
  }
});
