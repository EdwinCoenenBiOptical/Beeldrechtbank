# Moneybird via OAuth2: bedrijven en contactpersonen koppelen

De app leest contacten en bewaart een gecontroleerde koppeling op bedrijfsniveau.
Er worden geen Moneybird-contacten of facturen aangemaakt, gewijzigd of verstuurd.
Testbestellingen en downloads blijven ongewijzigd. Er is geen fallback naar een
persoonlijke API-token.

## Rechten: onderscheid tussen provider en onze app

Moneybird documenteert `sales_invoices`, `documents`, `estimates`, `bank`,
`time_entries`, `settings`. Elk van deze scopes behalve uitsluitend `time_entries`
kan toegang tot contacten geven. Wij vragen expliciet alleen `sales_invoices`.
De aangeleverde documentatie noemt geen aparte OAuth contacts- of alleen-lezen-scope.
Dit is dus GEEN garantie dat de token zelf alleen kan lezen; bij uitlekken gelden de
Moneybird-rechten van de token. Onze server heeft uitsluitend vaste lees-endpoints
voor contacten plus de administratiecontrole bij OAuth. Bank/documenten/instellingen
worden niet aangevraagd. Nicole moet de rechten controleren op het Moneybird-
toestemmingsscherm voordat zij akkoord gaat. Klanten hebben geen Moneybird-toegang.

## Registratie en Netlify

1. Registreer een externe OAuth-applicatie in Moneybird, naam **Beeldrechtbank**.
   Geen persoonlijke API-token. Gebruik deze exacte Redirect URI:

   `https://eclectic-bublanina-b08cc8.netlify.app/api/admin/moneybird/oauth/callback`

2. Zet in Netlify **Production** (Functions heeft toegang):

   | Variabele | Waarde | Geheim |
   | --- | --- | --- |
   | `MONEYBIRD_CLIENT_ID` | Client ID van de OAuth-app | Nee |
   | `MONEYBIRD_CLIENT_SECRET` | Client Secret van de OAuth-app | Ja |
   | `MONEYBIRD_ADMINISTRATION_ID` | ID van Nicole's administratie uit de Moneybird-URL | Nee |
   | `MONEYBIRD_ENCRYPTION_KEY` | Onafhankelijke willekeurige 32-byte sleutel in base64 | Ja |

   De bestaande `SUPABASE_SECRET_KEY` en `APP_URL` blijven nodig. `APP_URL` is de
   HTTPS-origin van de productie-app, zonder pad. Gebruik geen NEXT_PUBLIC-prefix.
   Laat preview/branch/local-contexten voor productiegeheimen leeg. Op Netlify Free
   is de scopekeuze vergrendeld; Functions is standaard al aangevinkt.
   Een eventuele oude `MONEYBIRD_API_TOKEN` wordt niet gebruikt en kan worden verwijderd.

3. Genereer de encryptiesleutel **op je eigen computer**, niet in chat. Bijvoorbeeld
   via Windows PowerShell (zet de sleutel rechtstreeks op je klembord):

   ```powershell
   $moneybirdKeyBytes = New-Object byte[] 32
   $moneybirdRng = [Security.Cryptography.RandomNumberGenerator]::Create()
   $moneybirdRng.GetBytes($moneybirdKeyBytes)
   [Convert]::ToBase64String($moneybirdKeyBytes) | Set-Clipboard
   $moneybirdRng.Dispose()
   ```

   Plak de waarde direct in de geheime Netlify-variabele en bewaar hem veilig.
   Ook mogelijk: lokaal `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   Deel Client Secret, encryptiesleutel en tokens niet in chat, CSV of screenshots.

4. Voer migraties `010_moneybird_contacts.sql` en `011_moneybird_oauth.sql` in die
   volgorde uit in Supabase SQL Editor. Ze vereisen account-/beheermigraties 001,
   004, 007; de bestaande bedrijvenzoeker gebruikt 008. Mailmigratie 006 is niet nodig.
5. Deploy pas nadat SQL en variabelen klaarstaan om een extra deployment te vermijden.

## Eenmalig verbinden

Open als Edwin **Mijn account → Bedrijven en Moneybird → Verbinden via Moneybird**.
Log bij Moneybird in met een account dat eigenaar is van Nicole's administratie,
controleer de gevraagde rechten en geef toestemming. De callback controleert of de
ingestelde administratie bereikbaar is; een verkeerde administratie wordt niet
opgeslagen. De browser krijgt nooit access-/refresh-tokens of de Client Secret.

Een verbindingspoging is aan de beheerder en een beveiligde HttpOnly/Secure-cookie
gebonden en verloopt na tien minuten. De server bewaart de state gehasht, verbruikt
hem eenmalig en verstuurt ook S256-PKCE-parameters. Moneybird's daadwerkelijke PKCE-
ondersteuning moet live worden bevestigd; client-secret-authenticatie en state-
controle zijn onafhankelijk daarvan actief. Tokens worden met AES-256-GCM en een
onafhankelijke encryptiesleutel versleuteld opgeslagen in een private tabel.

Als Moneybird `expires_in` en een refresh-token levert, vernieuwt de server de
verbinding vóór afloop. Zonder gedocumenteerde vervaltijd verzinnen we geen
expiratiedatum. Wanneer Moneybird de toegang weigert, kan opnieuw verbinden nodig
zijn. Verversen wordt met een databaselease geserialiseerd; de nieuwe tokens
worden opgeslagen voordat de app ze gebruikt. Een gewijzigde scope wordt geweigerd.

**Verbinding verbreken** verwijdert lokaal de versleutelde tokens. Trek ook de
provider-toestemming in Moneybird in via Externe applicaties/Actieve koppelingen;
lokaal verwijderen alleen trekt de grant bij Moneybird niet in. Bedrijfskoppelingen
blijven bewaard. Een oude callback of refresh kan een verbroken verbinding niet
terugzetten. Verbinden, vernieuwen en lokaal verbreken krijgen een private auditregel
zonder tokens. Bij wisselen van encryptiesleutel is opnieuw verbinden nodig.

## Bedrijf koppelen

Selecteer een portalbedrijf, zoek in Moneybird op KvK of bedrijfsnaam en klik
**Contact controleren**. Resultaten komen per 25. Controleer naam, KvK, adres en
factuur-e-mailadres en kies eventueel een bestaande Moneybird-contactpersoon.
De standaardkeuze neemt de bestaande factuurontvanger en het factuur-e-mailadres
over. Een persoon zonder eigen e-mailadres valt terug op het factuuradres van het
contact. Ontbrekende gegevens blijven zichtbaar als ontbrekend.

Bevestig en sla op. Bij ontbrekend/afwijkend KvK of vervanging van de bestaande
contact-/administratiekoppeling is een reden verplicht. **Gekoppeld contact opnieuw
controleren** haalt actuele gegevens op; wijzigingen worden bewust opnieuw
opgeslagen, er is geen automatische synchronisatie. Ontbrekende bedrijven maak je
in deze stap zelf in Moneybird aan. Er is geen externe contact-aanmaak vanuit de app.

## Bewaren en beveiliging

- Eén portalbedrijf heeft één koppeling; medewerkers delen die koppeling.
- Moneybird-IDs blijven tekst zodat lange nummers niet worden afgerond.
- Een factuurcontactpersoon is optioneel en staat los van portalaccounts.
- De server leest het contact opnieuw vóór opslaan; de browser levert alleen IDs,
  revisie, controlebevestiging en reden. Snapshots komen uit Moneybird.
- Host en administratie staan op de server vast; de browser kiest geen API-host
  of administratie. De providerclient volgt geen redirects met credentials.
- Gewone klanten hebben geen toegang tot de Moneybird-routes, mappings, tokens,
  private OAuth-state of schrijffuncties. Alleen expliciet aangewezen, goedgekeurde
  beheerders met bevestigde e-mail krijgen beheerrechten. Writes controleren Origin.
- Mappings hebben een auditlog en revisiecontrole. Eén Moneybird-contact kan niet
  aan twee portalbedrijven worden gekoppeld.
- Verplaatsen van medewerkers verplaatst geen bedrijfsrechten of oude bestellingen.
- De latere factuurintegratie moet afzonderlijk rechten en gegevens controleren,
  bestelling/factuurrelaties bewaren en dubbele facturatie voorkomen.

## Validatie

`npm test` test versleuteling, OAuth-requestgegevens, refresh-tokenverwerking,
verkeerde administratie/scope, providerfouten en echte lokale PostgreSQL-rechten,
eenmalige/expirerende state, beheerdersbinding, refresh-leases en revisiecontrole.
Browsercontroles gebruiken gesimuleerde API-antwoorden. Echte lokale HTTP-checks
testen ontbrekende login/Origin. Live toestemming, tokenvernieuwing en zoeken in
Nicole's Moneybird blijven te testen na configuratie. Er zijn nog geen live grants
of externe wijzigingen uitgevoerd vanuit deze ontwikkelomgeving.

Bron scopes: door Edwin aangeleverde Moneybird-authenticatiedocumentatie,
<https://developer.moneybird.com/authentication>.
