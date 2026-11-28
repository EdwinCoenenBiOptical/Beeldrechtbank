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

Besloten beeldbank met CSV-import, beveiligde watermerkpreviews, zoeken,
filters, raster/lijstweergave, bedrijfstarieven en checkout. Na script 019 zijn
catalogus en beelden alleen toegankelijk met een bevestigd, goedgekeurd account.
Registreren en wachtwoordherstel blijven voor bezoekers beschikbaar. De twaalf
historische voorbeeldbeelden worden alleen gebruikt als nog geen catalogus is
gepubliceerd; ook deze voorbeelden zijn beschermd. Zie onderaan voor de gezamenlijke
release van script 019 en de controle van bestellen/downloaden.

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
   pauzeer en hervat later. Bij een fout aan één bestand (ontbrekend, ongeldig of te groot) wordt dat beeld
   als mislukt geregistreerd en gaat de verwerking door. Bij verbindingsproblemen,
   verlopen toegang, HTTP 429, opslagproblemen of een onbekende uitkomst pauzeert
   de verwerking; het huidige beeld blijft dan beschikbaar voor hervatten.
   Mislukte bestanden kunnen na controle afzonderlijk opnieuw worden geprobeerd. Originelen groter
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

**Statusfilter in catalogusbeheer:** voer na 017 ook
`database/migrations/018_catalogue_status_filter.sql` eenmaal uit. Hiermee kun je
alle beelden, mislukte beelden, nog niet voorbereide beelden of gereedgemaakte
previews opvragen. De database filtert vóór paginering over de volledige import;
het totale aantal gereed/mislukt blijft dat van de volledige selectie. Bij een
geslaagde hercontrole blijft de gekozen filter actief en verdwijnt het herstelde
beeld uit de lijst Mislukt. Een leeg geworden laatste pagina schakelt terug naar
de laatste bestaande pagina. Dit script wijzigt geen beeldstatussen of bestanden.

### Besloten portal, echte bestellingen en originele downloads (script 019)

Voer `database/migrations/019_private_portal_orders.sql` eenmalig uit bij de
gezamenlijke release. Dit sluit ook de rechtstreekse anonieme Supabase-RPC af.
De previewbestanden en de 1.620 gepubliceerde beelden blijven behouden. Nieuwe
bestellingen gebruiken echte catalogus-ID's; bestaande proefbestellingen worden
niet omgezet of gefactureerd. Er worden geen nieuwe hostingvariabelen toegevoegd.

- Bezoekers starten op een inlogkaart. Registreren, e-mail bevestigen en een
  wachtwoord herstellen blijven bereikbaar. Een nog niet goedgekeurd account
  kan alleen de eigen accountstatus bekijken. De vaste header blijft zichtbaar
  tijdens scrollen; voor leden staan beeldbank, informatie en account in het menu.
- Catalogusgegevens, previews en voorbeeldbeelden vereisen bij elk verzoek een
  geldige, bevestigde, goedgekeurde sessie. API-responses zijn `private, no-store`.
  De twaalf oude voorbeeldbestanden staan buiten `public` en worden alleen via
  een beveiligde route geleverd. De algemene Next-image-optimizer is uitgeschakeld
  om geen openbare kopie van een beschermd beeld te kunnen cachen.
- `download=Nee` betekent uitsluitend bekijken: geen quote, nieuwe bestelling of
  originele download via de API/SQL. Voor toegestane beelden gebruikt checkout
  het bedrijfstarief, 21% btw, de actuele akkoordversie en de optionele PO-referentie.
  Een expliciet niet-Nederlands gekoppeld Moneybird-contact kan geen downloads kopen.
- Eén recht per bedrijf/beeld/gebruiksdoel wordt atomair vastgelegd. Collega's
  hergebruiken dat recht; een nieuwe prijs of PO-input overschrijft het oorspronkelijke
  akkoord niet. Downloaden en herhalen doen nooit een nieuwe factuur- of mailaanroep.
  De bestaande bestelmailregistratie verwerkt nieuwe bestellingen precies zoals
  eerder, met klant en Nicole als ontvangers. Er is nog geen automatische facturatie.
- Een origineel wordt uitsluitend aangeboden na een servercontrole van het huidige
  account, bedrijf, gebruiksrecht en beschikbaarheid. De oorspronkelijke bestandslocatie
  wordt privé bij de bestelregel bewaard. Verplaats originelen daarom niet zonder
  de bestaande downloadrechten mee te nemen in het beheer.
- De browser krijgt na een tweede rechtencontrole een tijdelijke Microsoft-download
  via een POST/303-omleiding. Dit voorkomt dat een groot TIFF-bestand door de
  Netlify-responslimiet of servergeheugenlimiet moet. OAuth-tokens worden nooit
  doorgegeven. De tijdelijke leverings-URL wordt niet opgeslagen of gelogd; bezit
  van die tijdelijke URL geeft toegang tot die ene download zolang Microsoft hem
  geldig houdt. Gebruik hiervoor geen permanente OneDrive-deellinks.
- Elke aanbieding wordt als `offered` geregistreerd, niet als bewijs dat het bestand
  op de computer is opgeslagen. Herhaald downloaden kan via de tekening of de
  bedrijfsbestelgeschiedenis. Goedkeuring, bedrijfswijzigingen en `download=Nee`
  worden ook bij herhaalde downloads opnieuw gecontroleerd.

Controle na de gezamenlijke Netlify-deploy en SQL 019: probeer zonder sessie ook
rechtstreeks een detailpagina en preview-URL; log in als goedgekeurd account,
plaats bewust één bestelling met PO, controleer beide bevestigingsmails en het
origineel. Download daarna opnieuw en controleer dat er geen tweede bestelling
of mail ontstaat. Controleer op mobiel de inlogkaart en tijdens scrollen de header.
De Moneybird-factuurproef blijft geïsoleerd tot eigen testbestellingen; deze release
maakt geen automatische factuur voor oude of nieuwe orders.

### Reguliere conceptfacturen (script 020)

Voer na 019 ook `database/migrations/020_order_invoice_drafts.sql` eenmaal uit.
Het script maakt een private wachtrij en auditlog. Alleen **nieuwe echte orders**
worden vanaf dat moment via een transactionele trigger toegevoegd; historische
orders en alle `is_test=true`-bestellingen worden niet ingehaald. Herhaalde
bevestigingen/downloads maken geen nieuwe order en dus geen nieuwe factuurtaak.
Er is geen automatische achtergrondverwerking of verzending in deze fase.

Beheer loopt via **Mijn account → Facturatie**:

1. Plaats voor de eerste controle bewust één nieuwe bestelling op je eigen bedrijf,
   voor een beeld/gebruiksdoel dat nog niet is besteld. Een oude bestelling opnieuw
   downloaden maakt geen nieuwe factuurtaak. De bestelling en bevestigingsmail
   blijven onafhankelijk van een Moneybird-storing werken.
2. Open de bestelling in Facturatie en controleer het factuurvoorstel. Het portal
   leest het actuele gekoppelde Moneybird-contact en factuurcontact, inclusief
   het factuur-e-mailadres. Dit mag bij reguliere facturatie een ander adres zijn
   dan dat van de besteller; de historische factuurproef blijft uitsluitend naar
   het eigen beheerdersadres werken.
3. Het KvK-nummer en volledige Nederlandse adres moeten passen bij het portalbedrijf.
   Btw is het bestaande unieke Nederlandse 21%-verkooptarief; omzet is Download,
   rekeningcode 80300 (omgezet naar het Moneybird-ID). Prijzen, btw, gebruiksdoelen,
   akkoord en PO komen uit de vastgelegde bestelling, niet uit actuele prijslijsten.
4. Bevestig de controle en maak één concept aan. De actie vergelijkt het voorstel
   opnieuw met verse contact-/factuurinstellingen. Een gewijzigde koppeling of
   een ander voorstel vereist een nieuwe controle. Het concept wordt na aanmaken
   teruggelezen en op contact, PO, regels, bedragen, btw en omzetrekening gecontroleerd.
5. Open het concept in Moneybird voor inhoudelijke controle en eventuele bewuste
   verzending. Het reguliere portal-endpoint heeft **geen verzendactie**. Controleer
   daarna vanuit beheer de status opnieuw; de gecontroleerde status/factuurnummer
   zijn ook zichtbaar in de bedrijfsbestelgeschiedenis.

Aanmaak wordt vóór de Moneybird-POST duurzaam als begonnen geregistreerd. Eén
lease per order voorkomt gelijktijdige aanmaak; het aflopen van een lease maakt
een eerdere schrijfuitkomst niet ongedaan. Bij een timeout of onbekende uitkomst
wordt nooit automatisch opnieuw aangemaakt. **Factuurstatus controleren / herstellen**
zoekt op het contact, de klantreferentie en het unieke leesbare bestelnummer in de
factuurregels. Een gevonden factuur wordt gecontroleerd en gekoppeld. Geen of
meerdere matches, een onvolledige zoekactie of een verwijderde bekende factuur
vereisen handmatige controle; de app maakt dan geen vervangend concept. Een zekere
providerweigering kan na correctie en een nieuwe expliciete controle opnieuw worden
geprobeerd. Een eerder uitgegeven factuur blijft als uitgegeven gemarkeerd, ook als
het document later wijzigt. De factuurkoppeling en transitie-audit blijven privé.

De duidelijkere downloadbevestiging gaat mee in dezelfde release: na bestellen
staat de downloadknop direct bovenaan de bevestiging, krijgt die bevestiging focus
en schuift het scherm ernaartoe. Mijn account blijft beschikbaar voor latere downloads.
Deze release gebruikt de bestaande Moneybird- en SMTP-instellingen; geen nieuwe
hostingvariabelen of scopewijzigingen zijn nodig.

### Beeldinformatie in de bestel- en downloadgeschiedenis

De accountoverzichten hergebruiken de catalogusgegevens die de ingelogde pagina
al ophaalt. Hiervoor is geen nieuwe SQL-migratie, herimport of extra catalogus-RPC
per overzicht nodig. Downloads geven naast de bestaande bestelregel ook de
`drawing_id` door om hetzelfde beeld te koppelen.

Bestellingen tonen achtereenvolgens bestelinformatie (nummer, moment, besteller,
PO), beeldinformatie met thumbnail (beeldnummer, titel, verdachte, zittingsdatum,
rechtbank), en de opgeslagen prijs/gebruiksafspraak met akkoordverklaring. De
originele bedragen, PO en akkoordtekst worden niet vervangen door catalogusdata.
De thumbnails gebruiken alleen de bestaande beveiligde watermerkpreview-URL's.

Downloads tonen een kleine thumbnail en één doorlopende regel met beeldnummer,
titel, verdachte, zittingsdatum, rechtbank, gebruiksdoel en bestandsgrootte; het
downloadmoment en de aanvrager blijven eronder zichtbaar. Bij een ontbrekend of
niet meer gepubliceerd beeld blijven titel/bestandsnaam uit de registratie
leesbaar en verschijnt een neutrale placeholder. Er wordt nooit een ander beeld
op basis van een titel of positie in de lijst gekoppeld.

### Aanmeldingsmeldingen via Rootnet (021)

Nieuwe accountaanvragen krijgen een beheerdersmelding naar **info@rechtbanktekeningen.nl**,
verstuurd vanaf info@beeldrechtbank.nl via dezelfde SMTP-configuratie als bestelbevestigingen.
De mail vermeldt naam, e-mailadres, aangevraagd bedrijf en KvK, met een link naar
https://www.beeldrechtbank.nl/#beheer. Er worden geen accounts automatisch goedgekeurd.
De aanmelding wordt bij het aanmaken gemeld; e-mailbevestiging blijft vereist voor goedkeuring.

Activeren:
1. Voer `database/migrations/021_registration_smtp.sql` **eenmaal** uit in Supabase SQL Editor.
   Dit werkt ook als de geparkeerde migratie 006 nooit is uitgevoerd. Oude aanvragen worden
   niet alsnog gemaild; bestaande wachtende meldingen krijgen `BEFORE_SMTP_ACTIVATION`.
   Herhaal dit script niet tijdens normaal gebruik: het sluit wachtende meldingen af.
2. Zet servervariabele `REGISTRATION_NOTIFICATIONS_ENABLED=true` in Netlify (Functions/runtime).
   Bestaande `SMTP_*`, `NEXT_PUBLIC_SUPABASE_URL` en `SUPABASE_SECRET_KEY` blijven in gebruik.
   Resend/DNS-aanpassingen en een nieuw wachtwoord zijn niet nodig.
3. Publiceer de code en controleer de Netlify Scheduled Function `registration-notifications`.
   Die draait alleen op production, elke vijf minuten, met maximaal drie aanvragen per ronde.
4. Test met één nieuwe aanvraag en controleer ontvangst bij info@rechtbanktekeningen.nl.

Wachtrijclaims voorkomen gelijktijdig verzenden; mislukte verzendingen worden later opnieuw
geprobeerd (maximaal tien pogingen). Bij een verbroken verbinding na SMTP-acceptatie kan
zoals bij andere SMTP-verzendingen een dubbele melding ontstaan. Aanvragen blijven bewaard
bij mailstoringen. De databasewachtrij is alleen voor de service-role toegankelijk.
Logs bevatten alleen aantallen of een generieke fout, geen persoonsgegevens of secrets.
Het bestaande POST-workerendpoint blijft optioneel bruikbaar met `NOTIFICATION_JOB_SECRET`.

### Account- en beheernavigatie

`AccountWorkspace` biedt onder de hoofdheader twee navigatiegroepen. Alle goedgekeurde
gebruikers zien Accountinformatie (`#account`), Bestellingen (`#bestellingen`) en Downloads
(`#downloads`). Die histories blijven beperkt tot hun eigen bedrijf. Beheerders krijgen
Aanmeldingen (`#beheer`, standaard wachtend), Personen (`#personen`, standaard goedgekeurd),
Bedrijven & Moneybird, Downloads (`#beheer-downloads`), Bestellingen (`#beheer-bestellingen`),
Facturen, OneDrive en Catalogus. De actieve pagina is gemarkeerd met `aria-current`.
Oude beheerlinks blijven werken; bestelmailinstellingen en de eerdere factuurproef zijn
bereikbaar onder Facturen. Er wordt hiervoor geen databasewijziging uitgevoerd.

`GET /api/admin/history?kind=orders|downloads&page=1` is een alleen-lezen overzicht voor
alle bedrijven. De server valideert eerst de ingelogde beheerder met `requireAdmin` voordat
de service-role wordt gebruikt; klanten krijgen hierdoor geen uitgebreidere databasepolicy.
De respons bevat naam/bedrijf, maar geen gebruikerscredentials, bronpaden of downloadlinks.
Het beheerbesteloverzicht biedt geen download namens een ander bedrijf. Factuuracties en
hun bescherming tegen dubbele facturen blijven in het bestaande facturatiescherm.
