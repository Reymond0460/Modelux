# MODELUX (happypocket)

Tienda estática en Firebase Hosting + Firestore. Pedidos por WhatsApp.

```
happypocket/
├── firebase.json     # config de Hosting (carpeta pública: public/)
├── .firebaserc       # proyecto: happypocket-5b7e9
└── public/           # TODO lo que se despliega
    ├── index.html    # estructura de la página
    ├── style.css     # estilos
    ├── script.js     # lógica (Firestore, carrito, admin, WhatsApp)
    └── 404.html
```

Desplegar: `firebase deploy --only hosting`
