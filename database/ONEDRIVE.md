# OneDrive Persoonlijk verbinden

Deze fase verbindt het account en controleert alleen bestandsmetadata. Downloads
voor redacties en facturabele bestellingen worden hiermee niet ingeschakeld.

## Instellingen

- Entra-app: `20c7ccf5-f526-430e-b4d0-8f59639cccd2`, alleen persoonlijke accounts.
- Web callback: `https://eclectic-bublanina-b08cc8.netlify.app/api/onedrive/callback`.
- Gedelegeerde Graph-machtigingen: Files.Read, User.Read, offline_access.
- Netlify Production: ONEDRIVE_CLIENT_ID en ONEDRIVE_CLIENT_SECRET. Secret uitsluitend
  in Netlify invoeren; nooit in Git, chat, screenshots of NEXT_PUBLIC-variabelen.
- APP_URL is optioneel en standaard de huidige Netlify-host. Bij een andere host
  moet deze variabele én de Entra-callback aangepast worden.

## Eenmalig uitvoeren

1. Voer `migrations/004_onedrive_connection.sql` volledig uit in Supabase SQL Editor.
   Het script wijst het al geverifieerde account van Edwin (UUID uit de huidige
   omgeving) aan als verbindingsbeheerder. Dit is geen bevoegdheid die gebruikers
   zelf kunnen aanvragen via registratie. Als dit gebruikers-ID ontbreekt, stop
   bij de fout; vervang het alleen na eigen controle door een echte beheerder-ID.
2. Wacht tot Netlify de nieuwe code heeft gepubliceerd met de bestaande variabelen.
3. Log als Edwin in op Beeldrechtbank en open Mijn account. Onder het profiel
   staat OneDrive verbinden. Start daar de koppeling.
4. Kies in Microsoft Nicole's persoonlijke account en laat Nicole toestemming geven.
   Houd de bestaande Beeldrechtbank-sessie in dezelfde browser open. Microsoft kan
   om een nieuwe aanmelding vragen; Supabase-inloggen blijft een aparte sessie.
5. De app controleert `Rechtbanktekeningen/BeeldRechtbank/NVH-001.jpg` in de OneDrive
   van het gekozen account. Alleen als het bestand leesbaar is, worden verbinding
   en metadata opgeslagen. Een JPEG wordt verwacht; geen openbare deellink nodig.
6. Controleer dat de verbonden naam Nicole is, dat het pad klopt en klik
   Testbestand controleren. Deze controle vernieuwt ook het toegangstoken als nodig.

## Beveiliging en beperkingen

De server gebruikt een OAuth authorization code flow met PKCE, een random state,
een tien minuten geldige HttpOnly/SameSite-cookie en binding aan de ingelogde
beheerder. Callbackcodes en tokens worden niet door onze code gelogd of aan de
frontend teruggegeven. Open redirects zijn niet mogelijk via invoerparameters.

Access- en refresh-tokens staan AES-256-GCM-versleuteld in een private Supabase-
tabel. De encryptiesleutel wordt afgeleid van het server-only Microsoft-clientgeheim.
Authenticatie van de ciphertext gebruikt verschillende contexten voor cookie
versus opgeslagen tokens. Slechts expliciet aangewezen, goedgekeurde beheerders
mogen de verbinding via gecontroleerde RPC's lezen/vervangen. Gewone redacteurs
kunnen geen tokens lezen of zichzelf beheerder maken. Updates zijn voorzien van
een revisiecontrole om een gelijktijdige nieuwe verbinding niet te overschrijven.

Wijziging van het clientgeheim vereist een nieuwe OneDrive-koppeling: eerder
versleutelde tokens kunnen met het nieuwe geheim niet worden geopend. Vervang
verlopen geheimen in Netlify, deploy opnieuw en verbind daarna opnieuw. Bij
intrekking van Microsoft-toestemming is eveneens een nieuwe verbinding nodig.

De Microsoft-toestemming geeft Files.Read voor het account; deze app gebruikt
momenteel uitsluitend het vaste testpad. Een openbare downloadroute bestaat nog
niet. Testgebruiksrechten geven dus nog geen toegang tot originelen. De latere
productiedownload moet echte en testrechten afzonderlijk controleren.

## Validatie

`npm test` controleert encryptie/tampering, state/PKCE, adminrechten, privétabel-
toegang en revisieconflicten lokaal. De browsercontrole gebruikt gesimuleerde
statussen; echte OAuth, tokenvernieuwing en het testbestand moeten op Netlify
met Nicole worden geverifieerd. Geen geheimen nodig voor de lokale tests.
