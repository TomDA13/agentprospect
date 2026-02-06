# Reddit Prospection Agent - UX/UI Design Services

Agent de prospection automatisé qui scanne Reddit pour trouver des prospects qualifiés pour des services de design UX/UI et Product Design ciblant les fondateurs de SaaS et applications.

## Fonctionnalités

- **Scan automatique** de 20 subreddits pertinents (SaaS, startups, product, design)
- **Détection par mots-clés** avec 3 niveaux de priorité (high, medium, low)
- **Qualification intelligente** : scoring urgence (1-10) et qualification (1-10)
- **Filtrage anti-spam** : vérification karma, âge du compte, détection job seekers
- **Détection européenne** : identification des prospects EU par mots-clés géographiques
- **Export Google Sheets** : mise à jour automatique avec déduplication
- **Backup local JSON** : sauvegarde locale des prospects
- **CLI configurable** : override du period, filtre EU, etc.

## Prérequis

- Node.js >= 18
- Compte Reddit avec une application API créée
- (Optionnel) Projet Google Cloud avec Sheets API activée

## Installation

```bash
cd reddit-prospection-agent
npm install
cp .env.example .env
```

Remplir le fichier `.env` avec vos identifiants.

## Configuration Reddit API

1. Aller sur https://www.reddit.com/prefs/apps
2. Cliquer "Create App" ou "Create Another App"
3. Sélectionner **"script"** comme type
4. Remplir :
   - name: `RedditProspector`
   - redirect uri: `http://localhost:8080`
5. Noter le **client ID** (sous le nom de l'app) et le **client secret**
6. Reporter dans `.env` :

```env
REDDIT_CLIENT_ID=votre_client_id
REDDIT_CLIENT_SECRET=votre_client_secret
REDDIT_USERNAME=votre_username_reddit
REDDIT_PASSWORD=votre_password_reddit
REDDIT_USER_AGENT=RedditProspector/1.0 (by /u/votre_username)
```

## Configuration Google Sheets (Optionnel)

1. Créer un projet dans Google Cloud Console
2. Activer l'API Google Sheets
3. Créer un compte de service (Service Account)
4. Télécharger le fichier JSON des credentials
5. Renommer en `google-credentials.json` et placer dans `config/`
6. Créer un Google Sheet et partager avec l'email du service account (en éditeur)
7. Copier l'ID du spreadsheet (dans l'URL) et le mettre dans `.env` :

```env
GOOGLE_SPREADSHEET_ID=votre_spreadsheet_id
```

Le sheet sera automatiquement configuré avec les colonnes suivantes :

| Date | Username | Résumé besoin | Subreddit | Score Urgence | Score Qualification | Raison | URL | Email | Upvotes | Statut |

## Utilisation

### Lancement standard (dernières 24h)

```bash
npm start
```

### Scan sur 48h

```bash
npm run start:48h
```

### Scan sur 7 jours

```bash
npm run start:week
```

### Prospects européens uniquement

```bash
npm run start:eu
```

### Options CLI

```bash
node src/main.js --period 72        # Dernières 72 heures
node src/main.js --eu-only          # Filtre européen
node src/main.js --help             # Aide
```

## Configuration

Tous les paramètres sont dans `config/config.json` :

### Subreddits

Modifier la liste `subreddits` pour ajouter/retirer des subreddits à scanner.

### Mots-clés

3 niveaux de priorité dans `keywords` :
- `high_priority` : besoin direct de designer (score max)
- `medium_priority` : problème conversion/rétention (score élevé)
- `low_priority` : demandes générales design (score moyen)

### Scoring

- `role_keywords` : détection du rôle (founder > PM > dev)
- `budget_indicators` : signaux de budget disponible
- `urgency_indicators` : signaux d'urgence temporelle
- `european_indicators` : mots-clés géographiques EU

### Filtres

- `period_hours` : période de recherche (défaut: 24)
- `min_score` : score Reddit minimum (défaut: 1)
- `min_account_karma` : karma minimum (défaut: 10)
- `min_account_age_days` : âge minimum du compte (défaut: 7)
- `filter_european_only` : ne garder que les prospects EU (défaut: false)

### Rate Limiting

- `requests_per_minute` : 30 (prudent, Reddit autorise 60)
- `delay_between_requests_ms` : 2000ms entre chaque requête
- `delay_between_subreddits_ms` : 5000ms entre chaque subreddit

## Subreddits surveillés

Les 20 subreddits configurés par défaut :

| Subreddit | Pertinence |
|-----------|-----------|
| r/SaaS | Fondateurs SaaS, demandes directes de design |
| r/startups | Startups early-stage, besoins MVP |
| r/Entrepreneur | Entrepreneurs, problèmes business |
| r/SideProject | Side projects cherchant designer |
| r/indiehackers | Indie hackers, bootstrappers |
| r/webdev | Développeurs cherchant designers |
| r/userexperience | Communauté UX, demandes d'aide |
| r/UI_Design | Design UI, critiques, demandes |
| r/ProductManagement | PMs avec problèmes produit |
| r/growmybusiness | Croissance business, conversion |
| r/advancedentrepreneur | Entrepreneurs avancés |
| r/EntrepreneurRideAlong | Build in public |
| r/microsaas | Micro-SaaS, solopreneurs |
| r/nocode | Nocode/lowcode cherchant design pro |
| r/buildinpublic | Build in public, lancements |
| r/techstartups | Tech startups |
| r/smallbusiness | PME avec besoins digitaux |
| r/digital_marketing | Marketing, conversion, landing pages |
| r/AppBusiness | Business d'apps mobiles |
| r/DesignCritiques | Demandes de critique design |

## Structure du projet

```
reddit-prospection-agent/
├── config/
│   ├── config.json                    # Configuration principale
│   ├── google-credentials.json        # Credentials Google (gitignored)
│   └── google-credentials.json.example
├── src/
│   ├── main.js                        # Orchestrateur principal + CLI
│   ├── reddit-scraper.js              # Scraping Reddit API
│   ├── analyzer.js                    # Qualification des prospects
│   └── sheets-exporter.js            # Export Google Sheets
├── data/
│   └── prospects.json                 # Backup local (gitignored)
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Automatisation (Cron)

Pour lancer automatiquement chaque jour à 8h :

```bash
# Éditer le crontab
crontab -e

# Ajouter cette ligne (adapter le chemin)
0 8 * * * cd /path/to/reddit-prospection-agent && /usr/bin/node src/main.js >> /var/log/reddit-prospector.log 2>&1
```

## Output

### Console

```
============================================================
  Reddit Prospection Agent - UX/UI Design Services
============================================================
  Started at: 2026-02-06T08:00:00.000Z
  Period: last 24 hours
  Subreddits: 20
  European filter: OFF
============================================================

[Reddit] Scanning r/SaaS...
[Reddit] Found 3 potential matches in r/SaaS
...

============================================================
  SUMMARY
============================================================
  Raw posts found:         45
  Qualified prospects:      12
  Exported to Sheets:       10 new, 2 duplicates
  Execution time:           120.5s
============================================================

  TOP PROSPECTS:
------------------------------------------------------------
  [Q:9/10 U:8/10] u/founder_xyz
    Looking for UX designer for my B2B SaaS MVP
    r/SaaS | 15 upvotes | https://...
    Raison: Role: founder | Besoin direct: "I need a UX/UI designer" | Produit: SAAS
```

### Google Sheets

Le spreadsheet est mis à jour automatiquement avec déduplication. Les prospects sont triés par score de qualification décroissant.

### Backup local

Le fichier `data/prospects.json` contient l'historique complet des prospects trouvés.
