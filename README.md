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

### Catalogusimport en previews (script 017)

Het beheer staat onder **Mijn account → Catalogus beheren**. Voer eerst
`database/migrations/017_catalogue_import.sql` eenmaal uit in Supabase. Dit maakt
private concepttabellen, een private Storage-bucket `catalogue-previews` en een
expliciete publicatie-instelling. Er zijn geen nieuwe omgevingsvariabelen nodig;
Supabase service-role en de bestaande OneDrive-koppeling worden gebruikt.
Er worden geen persoonsgegevens of catalogusregels uit een lokale CSV meegecommit.

1. Upload de bestaande `Catalogus.csv` (UTF-8, puntkomma, maximaal 2 MB/5.000 beelden).
   De 14 bestaande kolommen blijven gelijk. `beeld_map` begint met `Beelden` en
   `beeldsleutel` bevat de losse bestandsnaam. Het serverpad wordt
   `Rechtbanktekeningen/` + `beeld_map` + `/` + `beeldsleutel`.
2. Controleer aantallen, fouten, aandachtspunten en de voorbeeldpaden. Lege
   downloadkeuzes zijn **Nee**; andere onbekende vlaggen zijn fouten. `|` scheidt
   personen/trefwoorden. Engelse Excel-datums en ISO-datums worden naar ISO omgezet;
   een Excel-tijdstip van exact middernacht wordt bij een datum genegeerd.
3. Sla bewust een concept op. De huidige beeldbank blijft actief. Start met één
   preview en bekijk het watermerk voordat je de overige previews laat verwerken.
   Voor een kleine proef kun je een CSV met enkele volledige rijen gebruiken.
4. De beheerbrowser verwerkt beelden achter elkaar. Laat de pagina open of
   pauzeer en hervat later. Bij een fout pauzeert de verwerking; de fout is zichtbaar
   bij het beeld en kan na controle opnieuw worden geprobeerd. Originelen groter
   dan 64 MB of 80 miljoen pixels worden geweigerd. Alleen JPEG/PNG/TIFF worden
   gedecodeerd, bij TIFF alleen de eerste pagina. Er is geen achtergrondworker.
5. De preview is een JPEG van maximaal 1400 × 1100 pixels (zonder vergroten),
   maximaal 1 MB, met herhaalde vectorwatermerken. Originele EXIF/IPTC-metadata
   worden niet gekopieerd. Geen runtime-fonts nodig. Originelen worden uitsluitend
   tijdelijk in servergeheugen gelezen; alleen de verkleinde preview wordt opgeslagen.
6. Bekijk de resultaten. Publicatie vereist dat **elk** beeld met `publiceren=Ja`
   een voorbereide preview heeft. Na expliciete bevestiging wisselt de hele
   beeldbank in één databasehandeling naar de nieuwe selectie. Niet-genoemde
   beelden en `publiceren=Nee` komen niet in die publicatie. De vorige import
   blijft privé bewaard. Een volgende CSV is opnieuw een volledige selectie,
   geen toevoeging aan de bestaande publicatie.

Publieke bezoekers kunnen alleen metadata en watermerkpreviews uit de actieve
publicatie opvragen. Bronpaden, concepten en de Storage-bucket blijven privé.
Nieuwe preview-URL's bevatten een inhoudsversie; openbare responses hebben een
korte cacheduur van vijf minuten. Reeds door bezoekers bewaarde previews kunnen
niet achteraf worden ingetrokken. Voor TIFF/JPEG/PNG zijn de originelen nooit als
browserpreview gebruikt. Downloaden en reguliere checkout voor de geïmporteerde
catalogus worden afzonderlijk aangesloten: `download=Ja` bewaart de toestemming,
maar activeert in deze stap nog geen originele download of facturatie. Op de
detailpagina staat daarvoor voorlopig een contactmogelijkheid. `download=Nee`
blijft alleen bekijken. De bestaande twaalf proefbeelden en testbestellingen
blijven beschikbaar zolang er nog geen nieuwe catalogus gepubliceerd is; oude
bestellingen en rechten worden niet gewijzigd bij de cataloguswissel.

De broncontrole met de aangeleverde CSV omvat 1.633 unieke beelden, 1.401 met
`download=Ja` en 232 zonder downloadtoestemming (waarvan vier leeg). Bestaan en
leesbaarheid op OneDrive worden per beeld gecontroleerd bij het voorbereiden van
de preview, in de drive van het reeds gekoppelde account. Dit vereist een live
beheerderssessie; lokale tests gebruiken geen productiecredentials.
