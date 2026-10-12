# Beeldrechtbank

Eerste ontwikkelversie op basis van de HTML-mockup van Nicole van den Hout.

## Lokaal starten

Gebruik Node.js 24 en npm. Vanuit deze repository:

```sh
npm ci
npm run dev
```

Voor een productiebuild: `npm run build`, gevolgd door `npm start`.
Na de eerste build controleert `npm run typecheck` de TypeScript-code.

## Wat werkt

Openbare beeldbank met twaalf meegeleverde previewbeelden, zoekfunctie,
filters, sorteren, raster/lijstweergave en detailpagina met vergroting.
`GET /api/drawings` levert de openbare voorbeeldcatalogus.
Alle zaakgegevens zijn fictief; de beelden komen uit de aangeleverde mockup.

## Volgende stap

Echte Supabase-authenticatie, persoonlijke goedkeuring en koppeling aan bedrijven.
Daarna bedrijfstarieven voor Online, Print en TV, expliciete downloadafspraken,
privéopslag van originele bestanden en een beheerscherm.
Er is momenteel geen echte login, registratie of beschermde download beschikbaar.

`database/schema.sql` bevat een nog niet toegepaste basis voor het datamodel.
Row-level security staat standaard op blokkeren; toegangspolicies en beveiligde
serveracties moeten worden toegevoegd voordat dit model wordt gebruikt.
Elke afspraak bewaart de prijs, bedrijfsnaam, gebruiksnaam en akkoordtekst als
snapshot. Herhaald gebruik binnen het gekozen doel is toegestaan aan hetzelfde
bedrijf. Facturatie blijft buiten de applicatie.

De openbare previews zijn geen beschermde originelen. Controleer de toestemming
voor publicatie van de beelden en vervang fictieve gegevens vóór livegang.

## Opslagkeuze

De originele tekeningen blijven op OneDrive Persoonlijk (Microsoft Family).
Supabase wordt gebruikt voor authenticatie en de operationele database, niet
voor de opslag van alle originelen. Een latere Microsoft Graph-koppeling gebruikt
gedelegeerde toestemming van de eigenaar; Microsoft-appregistratie, veilige
opslag van tokens en tokenvernieuwing zijn nog niet ingericht. Een Family-
abonnement geeft de applicatie niet automatisch toegang tot bestanden.
Gebruik geen permanente openbare deellinks voor beschermde originelen.
De backend moet eerst accountstatus en bestaand gebruiksrecht controleren.
Hosting is nog niet gekozen en er is nog geen openbare applicatie-URL.
