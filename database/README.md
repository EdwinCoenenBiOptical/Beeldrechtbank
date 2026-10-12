# Supabase aansluiten

1. Open het juiste project en kies SQL Editor > New query.
2. Plak heel `migrations/001_accounts.sql` en voer het eenmaal uit.
   Het script is transactioneel. Bij een conflict met bestaande tabellen: stop
   en bespreek de fout; verwijder geen tabellen om opnieuw te proberen.
   `schema.sql` is alleen een toekomstige modelschets: voer die niet uit.
3. Authentication > Sign In / Providers: zet Email aan en Confirm email aan.
   De toepassing verwacht bevestigde e-mailadressen. Laat dit ingeschakeld.
4. Authentication > URL Configuration: stel de uiteindelijke hosting-URL als
   Site URL in. Voeg de exacte callback-URL toe aan Redirect URLs:
   `https://JOUW-HOST/auth/callback` en
   `https://JOUW-HOST/auth/callback?next=%2Freset-password`.
   Voor ontwikkeling op je eigen computer kun je de overeenkomstige URLs met
   `http://localhost:3000` toevoegen. De huidige testhost is `https://eclectic-bublanina-b08cc8.netlify.app`.
   Gebruik voor productie geen onbeperkte wildcard.
5. Stel de twee variabelen uit `.env.example` in bij je hosting. De publishable
   key is openbaar bedoeld. Gebruik hier nooit een secret/service_role-key.
6. Start de app. Registreer je met voornaam, tussenvoegsel (optioneel), achternaam,
   bedrijfsnaam, achtcijferig KvK-nummer en je eigen wachtwoord. Open de mail in
   dezelfde browser voor de PKCE-bevestiging. Bekijk Mijn account: pending.
7. Beoordeel de persoon én diens bevoegdheid namens het bedrijf. Voer na controle
   `approve-account.sql` uit met het juiste gebruikers-UUID. Het bedrijfsvoorbeeld
   is Edwin Coenen, KvK 77328949; het klantnummer wordt automatisch gegenereerd. Het script maakt geen gebruiker of wachtwoord.
   Een ander bedrijf moet eigen bedrijfsnaam en KvK-nummer krijgen.
   Alleen UUID en KvK die overeenkomen, met bevestigde e-mail, worden goedgekeurd.
8. Klik Status vernieuwen. Test afwijzing/opschorting en opnieuw inloggen.

Gebruikers mogen alleen hun eigen profiel en hun goedgekeurde bedrijf lezen.
Er zijn geen schrijfpolicies of schrijfgrants voor medewerkers. Goedkeuring
gebeurt voorlopig via de SQL Editor door de projecteigenaar; een beheerscherm
volgt later. Authenticatie betekent nog geen downloadtoegang. Backend-downloads
moeten later altijd de actuele profielstatus, bedrijf, tarieven en gebruiksrecht
controleren. De bestellingen en OneDrive-koppeling zijn nog niet aangesloten.

De standaard maildienst van Supabase kan ontvangers en aantallen beperken.
Als mail niet aankomt: controleer Authentication-logs en actuele mailinstellingen.
Stel zo nodig eigen SMTP in voordat je externe redacteuren uitnodigt.

## Acceptatiecontroles na aansluiten

- Nieuwe registratie krijgt uitsluitend `pending`, ook bij vervalste metadata.
- Bevestigen van e-mail verandert `pending` niet in `approved`.
- Een gebruiker ziet geen andere profielen of ongekoppelde bedrijven.
- Profielupdate, self-approval en bedrijfskoppeling via client/API zijn geweigerd.
- Ongeldig KvK, ontbrekende naam en goedkeuring zonder bedrijf worden geweigerd.
- Herhaald inloggen, uitloggen, herstelmail en nieuwe wachtwoorden werken.
- Afgewezen of opgeschorte accounts blijven zonder downloadtoegang.

Live uitvoering van deze controles vereist dat de SQL-migratie is toegepast,
callbacks ingesteld en een testpersoon de e-mailstappen zelf doorloopt.

## Bedrijfstarieven aansluiten

Na de accountmigratie en goedkeuring:

1. Voer `migrations/002_prices.sql` eenmaal uit in SQL Editor. Dit voegt actieve
   gebruiksdoelen en bedrijfstarieven met geldigheidsperiodes toe.
2. Voer `set-edwin-prices.sql` eenmaal uit. Voor het bestaande bedrijf met
   KvK 77328949 worden Online € 100, Print € 175 en TV € 250 ingesteld, exclusief
   btw. Er worden drie tariefregels teruggegeven. De bedragen zijn in eurocenten.
   Het script maakt geen nieuw bedrijf, bestelling of factuur.
3. Wacht tot de Netlify-deployment van de gewijzigde branch klaar is. Log in en
   open een tekening: dezelfde drie tarieven gelden voor elke tekening.
4. Wissel het gebruiksdoel. De gekozen prijs moet wijzigen; zonder tarief wordt
   'Op aanvraag' getoond. Er is nog geen download- of bestelknop.

Tarieven worden per KvK-gekoppeld bedrijf opgehaald vanuit het goedgekeurde
profiel, niet uit URL-parameters of door de gebruiker opgegeven bedrijf-ID's.
Niet-goedgekeurde accounts kunnen geen tarieven lezen of aanpassen. Een tweede
medewerker van hetzelfde bedrijf krijgt dezelfde tarieven.

De periode loopt vanaf `valid_from` (inclusief) tot `valid_until` (exclusief).
Een lege einddatum betekent onbeperkt. Datums gebruiken de UTC-dag, zoals de
Supabase-database. Overlappende periodes voor bedrijf/gebruiksdoel worden door
PostgreSQL geweigerd. Bij nieuwe tarieven: sluit de vorige periode af en maak
in één transactie een aansluitende periode. Historische bestelprijzen zullen
later apart als snapshots worden opgeslagen.

Dit tariefscript kan op dezelfde dag opnieuw worden uitgevoerd. Op een latere
uitvoeringsdag kan het niet zomaar naast een bestaande open periode worden
geplaatst; bespreek eventuele fouten voordat je opnieuw uitvoert.
