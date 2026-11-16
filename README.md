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

## Beheerscherm voor aanmeldingen

Het bestaande beheeraccount kan nieuwe aanvragen bekijken, aan een KvK-gekoppeld
bedrijf koppelen en goedkeuren/afwijzen. Hiervoor is migratie 007 nodig; de
geparkeerde notificatiemodule (006) hoeft niet te worden ingesteld.
Zie [de beheerhandleiding](database/ADMIN_APPLICATIONS.md). Wijzigingen worden
lokaal getest en per afgeronde werkstap gebundeld om deployments te beperken.

### Bestelbevestigingen via Rootnet (script 016)

Deze module verstuurt één bevestiging per nieuwe bestelling vanuit
`Beeldrechtbank <info@beeldrechtbank.nl>`. Nicole ontvangt een BCC op
`rechtbanktekeningen@nicolevandenhout.nl`; antwoorden gaan naar datzelfde adres.
De mail bevat bestelregels, opgeslagen bedragen, 21% btw en de eventuele
klantreferentie/het PO-nummer. Opnieuw downloaden geeft geen nieuwe mail.
Facturen en kopieën daarvan blijven volledig bij Moneybird.

**Voorbereid, standaard uitgeschakeld.** Er wordt geen historische mail verstuurd.
SQL-script `database/migrations/016_order_confirmation_mail.sql` maakt een private
verzendregistratie en een beheerinstelling die standaard uit staat. Script 006
(Resend/aanmeldmeldingen) is hiervoor niet nodig en blijft geparkeerd.

Ingebruikname, zodra Rootnet DNS en de mailbox heeft bevestigd:

1. Controleer via de door Rootnet opgegeven webmail zowel ontvangen als verzenden
   met `info@beeldrechtbank.nl`. Controleer ook dat Nicole mail kan ontvangen.
2. Voer script 016 uit in Supabase, na de bestaande migraties tot en met 015.
3. Stel in Netlify uitsluitend server-side variabelen in: `SMTP_HOST=rootnet.email`,
   `SMTP_PORT=587` (STARTTLS; alternatief 465 met TLS),
   `SMTP_USER=info@beeldrechtbank.nl`, `SMTP_PASSWORD` met het mailboxwachtwoord.
   Geen `NEXT_PUBLIC_`-prefix. Deel het wachtwoord niet via chat of Git.
4. Zet `ORDER_MAIL_ENABLED=true` voor de gecontroleerde test. Dit zet de
   automatische bestelmail nog niet aan: daarvoor geldt een tweede beheerschakelaar.
   Laat `APP_URL` op het werkende Netlify-adres staan zolang het eigen webdomein
   nog niet afzonderlijk is gekoppeld en getest.
5. Open als beheerder **Bestelbevestigingen** (`/#bestelmails`). Controleer het
   voorbeeld en stuur bewust één test naar je eigen ingelogde beheerdersadres,
   met BCC aan Nicole. Hiervoor ontstaat geen bestelling of factuur.
6. Controleer ontvangst bij beiden, spammap, afzender, antwoordadres en
   SPF/DKIM-resultaten. Activeer daarna pas automatische bevestigingen in beheer.
7. Plaats één nieuwe testbestelling met PO-nummer. Controleer beide mails en
   download opnieuw: er mag geen tweede bevestiging ontstaan.

SMTP-acceptatie betekent dat de server de mail heeft aangenomen, niet dat de
ontvanger hem daadwerkelijk heeft ontvangen. Bounces komen op de verzendmailbox.
Een mislukte mail maakt een vastgelegde bestelling niet ongedaan. Beheer toont
recente verzendstatussen; alleen zekere mislukkingen kunnen handmatig opnieuw
worden aangeboden. Bij gedeeltelijke acceptatie, een onbekende uitkomst of een
onderbroken verzending vindt geen automatische herhaling plaats: controleer
ontvangst en laat Rootnet zo nodig de verzendlogs controleren. Dit voorkomt dat
onzekerheid stilzwijgend tot dubbele mails leidt.

Pauzeren kan via beheer of met `ORDER_MAIL_ENABLED=false`. De beheerinstelling
bepaalt of nieuwe bestellingen worden geregistreerd voor verzending; tijdens een
pauze wordt geen achteraf te versturen stapel opgebouwd. Bestaande wachtende
registraties blijven zichtbaar. Er is geen periodieke achtergrondwerker: een
verzending wordt na het vastleggen van de bestelling aangeboden, of expliciet
vanuit beheer hervat als dat veilig kan.
