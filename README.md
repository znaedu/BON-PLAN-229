# BON PLAN 229

MVP initial d'une marketplace locale permettant de publier, rechercher et contacter des vendeurs.

## Structure

- `public/index.html` : interface publique
- `public/style.css` : design
- `public/app.js` : logique de l'interface
- `database.js` : base SQLite
- `server.js` : serveur API
- `.env.example` : variables d'environnement
- `package.json` : dépendances Node.js

## Important

Ce dépôt est une base MVP. Les paiements réels, l'administration sécurisée, les webhooks FedaPay, les SMS/USSD et la gestion des litiges doivent être configurés avant la production.

Ne jamais placer une vraie clé API FedaPay dans GitHub.
