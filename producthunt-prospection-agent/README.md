# Product Hunt Prospection Agent

Agent qui scanne les lancements Product Hunt pour trouver des prospects qualifies (fondateurs SaaS/apps) ayant besoin de services UX/UI et Product Design.

## Pourquoi Product Hunt ?

- Les makers lancent leur produit = moment ideal pour proposer du design
- Profils publics avec Twitter, website, headline
- Signaux clairs : beta, MVP, "looking for feedback"
- Fondateurs accessibles et dans une logique d'amelioration

## Fonctionnalites

- **API GraphQL Product Hunt** : scan des lancements recents par date et par topic
- **15 topics surveilles** : SaaS, DevTools, Fintech, AI, No-Code...
- **Scoring double** : qualification (1-10) + urgence (1-10)
- **Detection UX faiblesse** : signaux beta/MVP/feedback/v1
- **Contact extraction** : Twitter maker, website, email si present
- **Filtre low-value** : exclut books, templates, icon packs, newsletters
- **Export Google Sheets** avec deduplication
- **Backup JSON local**

## Installation

```bash
cd producthunt-prospection-agent
npm install
cp .env.example .env
```

## Configuration Product Hunt API

1. Aller sur https://www.producthunt.com/v2/oauth/applications
2. Creer une application (ou utiliser "Developer Token")
3. Copier le token dans `.env` :

```env
PH_API_TOKEN=votre_token_ici
```

C'est tout. Pas besoin d'OAuth complexe, le Developer Token suffit.

## Configuration Google Sheets (optionnel)

Meme process que l'agent Reddit :
1. Google Cloud Console -> activer Sheets API
2. Creer Service Account -> telecharger JSON
3. Placer dans `config/google-credentials.json`
4. Partager le Sheet avec l'email du service account
5. Ajouter l'ID du Sheet dans `.env`

## Utilisation

```bash
# Lancements des 7 derniers jours (defaut)
npm start

# Lancements d'aujourd'hui seulement
npm run start:today

# 30 derniers jours
npm run start:30d

# Tout inclure (min 0 votes)
npm run start:all

# Options CLI
node src/main.js --period 14 --min-votes 10
node src/main.js --help
```

## Scoring

### Qualification (1-10)

| Signal | Points |
|--------|--------|
| Produit SaaS/B2B/app/platform | +2 |
| Signaux UX faible (beta, MVP, feedback) | +1 a +2 |
| Maker = founder/CEO | +1.5 |
| Funded / YC / revenue | +1 a +1.5 |
| Bonne traction (30-100+ votes) | +0.5 a +1 |
| Website present | +0.5 |
| Contact disponible (Twitter/email) | +1 |
| Prospect europeen | +0.5 |

### Urgence (1-10)

| Signal | Points |
|--------|--------|
| Base | 3 |
| Lance aujourd'hui | +2 |
| Lance dans les 3 jours | +1 |
| Demande feedback explicitement | +2 |
| Beta / MVP / prototype | +1 |
| Mauvais ratings | +1 |
| Traction elevee | +1 |

## Output console

```
============================================================
  Product Hunt Prospection Agent
  UX/UI & Product Design for SaaS
============================================================

  TOP PROSPECTS:
------------------------------------------------------------
  [Q:9/10 U:8/10] AwesomeSaaS
    "The all-in-one platform for remote teams"
    Maker: John Doe (johndoe) | @johndoe
    156 votes | https://www.producthunt.com/posts/awesomesaas
    Raison: Produit: SAAS | Maker: founder | Signal UX: "beta" | Traction: 156 votes
    Site: https://awesomesaas.com
```

## Google Sheets colonnes

| Date | Produit | Tagline | Maker | PH Username | Twitter | Website | Score Urgence | Score Qualification | Raison | URL PH | Email | Votes | Statut |

## Structure

```
producthunt-prospection-agent/
├── config/
│   └── config.json            # Parametres (topics, scoring, filtres)
├── src/
│   ├── main.js                # Orchestrateur + CLI
│   ├── ph-scraper.js          # Product Hunt GraphQL API
│   ├── analyzer.js            # Qualification des prospects
│   └── sheets-exporter.js     # Export Google Sheets
├── data/
│   └── prospects.json         # Backup local
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Automatisation (cron)

```bash
# Tous les jours a 9h
0 9 * * * cd /path/to/producthunt-prospection-agent && node src/main.js >> /var/log/ph-prospector.log 2>&1
```
