# E-mail bij nieuwe aanmelding

Doeladres: **rechtbanktekeningen@nicolevandenhout.nl**. Dit is vastgezet in de
servercode; een aanvrager kan de ontvanger niet aanpassen. Het bericht bevat
naam, e-mailadres, bedrijfsnaam en KvK-nummer, nooit wachtwoorden of tokens.
Het betreft een nieuwe aanvraag; e-mailbevestiging en jouw goedkeuring blijven
aparte stappen. Bestaande accounts worden niet achteraf gemeld.

De notificatiemodule is voorlopig geparkeerd en staat standaard uit. Activering
vereist later expliciet `REGISTRATION_NOTIFICATIONS_ENABLED=true`. Beoordeel dan
eventuele al aanwezige wachtrij-items voordat je de worker activeert.

## Nog benodigd voordat mail werkt

1. Een maildienst. De code gebruikt Resend; kies het gratis abonnement en blijf
   binnen de daarin geldende limieten. Verifieer een afzenderdomein met de DNS-
   records die Resend opgeeft. De hostingbeheerder kan dit doen. Een afzonderlijk
   verzendsubdomein kan conflicten met bestaande mailinstellingen voorkomen.
2. Netlify Production-variabelen, server-only en als geheim waar van toepassing:
   - RESEND_API_KEY: sleutel met alleen verzendbevoegdheid voor het geverifieerde domein.
   - NOTIFICATION_FROM_EMAIL: een toegestane afzender, bijvoorbeeld
     `Beeldrechtbank <aanmeldingen@nicolevandenhout.nl>` nadat dat domein geverifieerd is.
   - SUPABASE_SECRET_KEY: Supabase secret key, uitsluitend hier invoeren; een
     legacy service_role-key kan ook via SUPABASE_SERVICE_ROLE_KEY. Nooit een
     privileged key in NEXT_PUBLIC, Git of chat plaatsen.
   - NOTIFICATION_JOB_SECRET: een aparte willekeurige waarde van minstens 32
     tekens, bijvoorbeeld via je wachtwoordmanager. Geen Supabase-key hiervoor hergebruiken.
3. Voer migratie `006_registration_notifications.sql` eenmaal uit.
4. Laat Netlify de nieuwe code publiceren met de variabelen.
5. Supabase Database > Webhooks: maak een webhook voor INSERT op
   `public.registration_notifications`, methode POST, naar
   `https://eclectic-bublanina-b08cc8.netlify.app/api/notifications/registrations`.
   Voeg header `x-notification-secret` toe met de NOTIFICATION_JOB_SECRET uit
   Netlify. Voer de waarde veilig in het dashboard in; deel die niet in chat.
6. Configureer daarnaast een periodieke HTTP-aanroep met dezelfde header via
   Supabase Cron, bijvoorbeeld elke 15 minuten. Deze verwerkt ook achtergebleven
   notificaties/retries. Bewaar het jobgeheim in Supabase Vault voor zo'n job en
   verwijs naar het Vault-record; zet de waarde niet in een repository-script.

Aanmelden zelf voert geen mail-HTTP-aanvraag uit. De database bewaart de melding
in dezelfde transactie als het nieuwe profiel. De webhook start de worker pas
na het opslaan. De worker gebruikt de privileged sleutel alleen voor twee RPC's
om maximaal drie wachtrij-items op te halen en resultaten vast te leggen.

## Betrouwbaarheid en testen

Items worden exclusief geclaimd met een lease en token. Resend krijgt een
idempotency-key per notificatie. Een tijdelijke fout wordt `retry`, met vijf
minuten wachttijd; maximaal tien pogingen. De periodieke job blijft nodig, ook
als een webhook een keer uitvalt. Bij `failed` moeten mailinstellingen en de
providerlogs worden gecontroleerd voordat het item handmatig opnieuw geprobeerd
wordt. Een geslaagde providerresponse betekent `sent`, niet dat iemand de mail
heeft gelezen of dat inboxbezorging gegarandeerd is.

Test na configuratie één nieuwe aanmelding. Controleer het ontvangstadres, de
berichtinhoud, de status in `registration_notifications` en Resend-deliverylogs.
Verstuur geen oude wachtrij opnieuw zonder reden. Lokale tests gebruiken een
fake mailprovider; er is nog geen echte e-mail verzonden of live gevalideerd.

## Eigen domein voor de webapp

Een geregistreerd `www.beeldrechtbank.nl` kan aan dezelfde Netlify-app gekoppeld
worden. Laat de DNS-beheerder de door Netlify getoonde records toepassen en kies
één primair domein. Domeinregistratie is een aparte kostenpost.

Pas daarna Supabase Site URL/redirects, de Entra Web-callback, APP_URL in Netlify
én de mailworker-webhook/cron-URL aan. Laat de oude koppeling bestaan tot de nieuwe
URLs zijn getest. Een DNS-provider beheren is iets anders dan alle DNS-records
van nicolevandenhout.nl kopiëren; bestaande mailrecords blijven behouden.
