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

## Testbestelling en akkoordverklaring

Voer `migrations/003_test_orders.sql` eenmaal uit, na 001 en 002. Laat bestaande
account- en tariefgegevens intact. Dit voegt de twaalf voorbeeldtekeningen,
een voorwaardenversie, testbestellingen, bestelregels en aparte gebruiksrechten toe.
Alle bestellingen in deze fase hebben `is_test = true`; dit wordt door de
SQL-constraints afgedwongen. Er worden geen facturen of originele downloads gemaakt.
De overstap naar echte bestellingen vereist een aparte migratie en de OneDrive-koppeling.

Na de Netlify-deployment: open een tekening, kies Online, Print of TV, controleer
bedrijf, titel, doel, bedrag exclusief btw, 21% btw en totaal. Vink de weergegeven
akkoordverklaring aan en klik Testbestelling bevestigen. De knop blijft zonder
akkoord uitgeschakeld. Daarna zie je het testbestelnummer en de bewaarde afspraak.
Herlaad de pagina: hetzelfde recht wordt teruggevonden. Een tweede medewerker van
hetzelfde bedrijf kan hetzelfde recht gebruiken zonder nieuwe bestelling.

| Gebruik | Excl. btw | 21% btw | Inclusief btw |
| --- | ---: | ---: | ---: |
| Online | € 100,00 | € 21,00 | € 121,00 |
| Print | € 175,00 | € 36,75 | € 211,75 |
| TV | € 250,00 | € 52,50 | € 302,50 |

Btw wordt per bestelregel naar de dichtstbijzijnde hele cent afgerond; halve
centen naar boven. De server berekent prijs en btw opnieuw en vergelijkt de
zichtbare prijs en exacte akkoordtekst. Bij een wijziging moet de gebruiker
opnieuw controleren en akkoord gaan. De server neemt geen bedrijf-ID, totaal of
zelfgeschreven voorwaarden van de browser over als waarheid.

`orders`, `order_items` en `usage_rights` zijn alleen leesbaar voor goedgekeurde
medewerkers van het betreffende bedrijf. Rechtstreekse writes zijn geblokkeerd;
de transactionele RPC controleert ook bij directe aanroepen e-mailbevestiging,
goedkeuring, tarief, publicatiestatus en expliciet akkoord. De bevestiging en
het gebruiksrecht worden samen opgeslagen; herhaling wordt per bedrijf/beeld/doel
herkend. Bewaar oude voorwaardenversies: nieuwe tekst krijgt een nieuw record in
`agreement_versions`, waarnaar `checkout_settings.agreement_id` gaat verwijzen.

`npm test` controleert dit in lokale PostgreSQL. Live werking vereist het script
en een eigen handmatige test; de lokale browsercontrole gebruikt gesimuleerde API-antwoorden.

## Bestelgeschiedenis

Mijn account toont nu de bestellingen van het goedgekeurde bedrijf, inclusief
bestellingen van collega's. Het overzicht toont tien bestellingen per pagina,
nieuwste eerst, met datum/tijd in Europe/Amsterdam, gebruiksdoel, vastgelegde
bedragen en exacte akkoordverklaring. Vernieuwen haalt actuele gegevens op.
Het overzicht gebruikt de bestaande tabellen en RLS uit migratie 003; voer
hiervoor geen migratie opnieuw uit. Directe API-toegang wordt ook gecontroleerd
op login, bevestigde e-mail, profielstatus en gekoppeld bedrijf.

Downloadgebeurtenissen zijn nog niet aangesloten. Het overzicht geeft daarom
nog geen gesimuleerde of afgeleide downloads weer. Een bestelling is geen download.

## Personen koppelen aan bedrijven

Voer migratie `008_company_assignment.sql` uit na migratie 007. Migratie 006
voor notificaties is hiervoor niet nodig en blijft geparkeerd.

Open als beheerder Mijn account → Beheer. Kies de status van de persoon,
selecteer een bestaand bedrijf (zoek op naam of KvK), of kies Nieuw bedrijf en
vul naam en achtcijferig KvK-nummer in. Het klantnummer ontstaat automatisch.
Controleer de bevoegdheid van de persoon en vink de controle aan.

- **Bedrijfskoppeling opslaan** wijzigt uitsluitend het gekoppelde bedrijf;
  de status pending/approved/rejected/suspended blijft behouden.
- **Koppelen en goedkeuren** koppelt het gekozen bedrijf en keurt de aanvraag
  goed. E-mailbevestiging is vereist.
- Bij een afwijkende aanvraag of bedrijfswissel is een reden verplicht.

Een persoon heeft één `profiles.company_id`; meerdere personen mogen hetzelfde
bedrijf hebben. De oorspronkelijke aanvraag blijft bewaard. De beheerlog bewaart
oude/nieuwe koppeling, reden en beoordelaar. Bestaande bestellingen, prijzen en
gebruiksrechten worden niet naar het nieuwe bedrijf verhuisd. Een goedgekeurde
persoon ziet na de wijziging alleen de gegevens van het huidige bedrijf.
Gelijktijdig gewijzigde persoonsgegevens geven een melding om te vernieuwen.
