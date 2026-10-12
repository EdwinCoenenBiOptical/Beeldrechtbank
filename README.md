# Beeldrechtbank

Eerste ontwikkelversie op basis van de HTML-mockup van Nicole van den Hout.

## Lokaal starten

Gebruik Node.js 24 en npm. Vanuit deze repository:

```sh
npm ci
npm run dev
```

Kopieer `.env.example` naar `.env.local` en vul de publishable key in.
Voor een productiebuild: `npm run build`, gevolgd door `npm start`.
Na de eerste build controleert `npm run typecheck` de TypeScript-code.

## Wat werkt

Openbare beeldbank met twaalf meegeleverde previewbeelden, zoekfunctie,
filters, sorteren, raster/lijstweergave en detailpagina met vergroting.
`GET /api/drawings` levert de openbare voorbeeldcatalogus.
Alle zaakgegevens zijn fictief; de beelden komen uit de aangeleverde mockup.

## Volgende stap

Registratie, inloggen, e-mailbevestiging, wachtwoordherstel en accountstatus
zijn geïmplementeerd. Live gebruik vereist de Supabase-migratie en instellingen
in [database/README.md](database/README.md). Persoonlijke goedkeuring gebeurt
voorlopig via de SQL Editor. Bedrijfstarieven voor Online, Print en TV zijn aangesloten via `GET /api/prices`.
Voer eerst `002_prices.sql` en het afzonderlijke tariefscript uit volgens de
databasehandleiding. Testbestellingen met expliciet akkoord, 21% btw en bewaarde prijs-/tekst-snapshots
zijn toegevoegd. Voer `003_test_orders.sql` uit om dit te proberen. Alle
bestellingen zijn voorlopig testbestellingen, zonder factuur of origineel bestand.
Vervolgens sluiten we OneDrive-downloads en het beheerscherm aan.
Klantdownloads zijn nog niet beschikbaar; er is nu een afzonderlijke beheerderstest. De gebruiker heeft live
registratie, e-mailbevestiging en goedkeuring in de testapp doorlopen. De gebruiker heeft ook de live bedrijfstarieven gecontroleerd. De nieuwe
testbestelstap vereist nog migratie 003 en een eigen live test.

`database/schema.sql` bevat een nog niet toegepaste basis voor het datamodel.
Voer deze modelschets niet uit. De uitvoerbare accountmigratie staat apart onder
`database/migrations`. `npm test` controleert de migratie, profieltrigger en
lees-/schrijfrechten in lokale PostgreSQL (PGlite), zonder live projectwijzigingen.
Bij toekomstige bestellingen bewaren we de prijs, bedrijfsnaam, gebruiksnaam
en akkoordtekst als snapshot. Herhaald gebruik binnen het gekozen doel is toegestaan aan hetzelfde
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
De testapp staat op https://eclectic-bublanina-b08cc8.netlify.app/ via branch
`initial-image-catalogue`. Nieuwe commits moeten daar eerst worden gedeployd.

## Besteloverzicht

Goedgekeurde gebruikers zien in Mijn account de bestelgeschiedenis van hun
bedrijf, met prijs-/btwsnapshots en de bewaarde akkoordverklaring.
`GET /api/orders/history?page=1` levert een beveiligd, gepagineerd overzicht.
Nieuwe SQL is hiervoor niet nodig nadat migratie 003 is uitgevoerd.
Downloadgeschiedenis volgt bij het aansluiten van echte downloadgebeurtenissen.

## OneDrive-verbinding

De beheerder kan nu OneDrive Persoonlijk verbinden en het vaste testbestand
controleren. Zie [de verbindingshandleiding](database/ONEDRIVE.md) en migratie 004.
Microsoft-tokens blijven versleuteld op de server. Klantdownloads zijn nog niet
geactiveerd; testbestellingen veroorzaken geen factuur.

## Testdownload en downloadgeschiedenis

De beheerder kan nu, na migratie 005, het gekoppelde JPEG-testbestand downloaden
bij een bestaand testgebruiksrecht voor NVH-0001. Downloadregistratie blijft apart
van bestellingen; herhalen maakt geen extra bestelling. Zie
[de testdownloadhandleiding](database/TEST_DOWNLOADS.md). Klantdownloads blijven
uitgeschakeld; deze fase is uitsluitend een beheerderstest met één bestand.

## Aanmeldingsnotificaties

Nieuwe aanmeldingen kunnen via een beveiligde mailworker worden gemeld aan
rechtbanktekeningen@nicolevandenhout.nl. De code en wachtrij zijn voorbereid;
maildienst, afzenderverificatie, server-only variabelen en webhook/periodieke job
moeten nog worden ingesteld. Zie [de mailhandleiding](database/REGISTRATION_EMAIL.md).
Er zijn hiervoor nog geen live e-mails verstuurd.
