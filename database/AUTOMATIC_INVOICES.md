# Automatische facturatie — direct versturen

Afspraak Edwin/Nicole, 28 november 2026:
- Eén factuur per nieuwe echte bestelling, direct per e-mail vanuit Moneybird.
- Gebruik het factuuradres/de gekoppelde factuurcontactpersoon in Moneybird.
- Volg de bestaande contactworkflow/betalingstermijn, geen vaste portaltermijn.
- Storingsmeldingen naar info@rechtbanktekeningen.nl via bestaande Rootnet SMTP.
- Bestaande bestellingen, eerdere concepten en alle testbestellingen uitsluiten.
- Herhaald downloaden maakt geen nieuwe bestelling of factuur.

## Inrichten in één deployment

1. Voer `migrations/022_automatic_invoices.sql` éénmaal uit in Supabase SQL Editor.
   Script 020 moet al zijn uitgevoerd. De nieuwe instellingen beginnen UIT.
   Er is geen nieuwe Netlify environment variable of OAuth-app nodig.
2. Publiceer de code. Netlify Scheduled Function `invoice-automation` draait op
   production elke vijf minuten en behandelt maximaal één bestelling per ronde.
3. Controleer in Beheer → Bedrijven & Moneybird de klantkoppeling, het factuuradres,
   factuurcontactpersoon en de betaalworkflow van het contact in Moneybird.
4. Ga naar Beheer → Facturen. Vink de expliciete verklaring aan en klik
   **Inschakelen en direct versturen**. De eerste inschakeldatum wordt vastgelegd.
   Alleen daarna aangemaakte bestellingen komen in aanmerking. Pauzeren en hervatten
   wijzigt die eerste datum niet: bestellingen tijdens een pauze blijven klaarstaan.
5. Plaats bewust één nieuwe **echte proefbestelling**. Die leidt tot een echte,
   verzonden factuur; gebruik de afgesproken testklant en creditteer zo nodig handmatig
   in Moneybird. De oude testbestellingen worden nooit gebruikt voor deze proef.
6. Controleer: één factuur, de juiste ontvanger, bedrag/21%/omzetrekening 80300,
   PO-kenmerk, contactworkflow en vervaldatum, ontvangst, status Verstuurd in het portal.
   Controleer ook dat opnieuw downloaden geen factuur oplevert.

De betaalworkflow van het verse Moneybird-contact wordt bij automatische aanmaak expliciet
meegegeven als het contact er één heeft. Zonder afwijkende contactworkflow wordt geen
workflow of vervaldatum overschreven en gebruikt Moneybird zijn contact-/administratiedefault.
Er worden geen 14/30 dagen, `due_date` of `payment_conditions` vanuit het portal geforceerd.
De echte vervaldatum en de verzending moeten met bovenstaande praktijkproef worden bevestigd.
De reguliere verzending gebruikt de Moneybird-template, zonder proef-/credittekst.
Buitenlandse factuurcontacten zijn nog niet ondersteund door de bestaande 21%-facturatie.

## Storingen en herstel

De bestaande factuurjob vormt het duurzame grootboek voor aanmaken en lezen. Een unieke
provider-id, exclusieve lease en een vastgelegd startpunt vóór POST beschermen tegen
dubbele aanmaak. Na een onbekende POST-uitkomst wordt alleen gezocht en gelezen: geen
nieuwe aanmaak zolang de eerdere uitkomst onzeker is. Onduidelijke of afwijkende documenten
vragen handmatige controle.

Voor PATCH/send_invoice wordt apart `delivery_state=sending` vastgelegd, met controle op
hoofdschakelaar, administratie, klantkoppeling en revisie. Het factuuradres, adresgegevens en
de contactworkflow worden opnieuw gelezen. Een verlopen lease wist het verzendstartpunt niet.
Bij een onbekende PATCH-uitkomst wordt nooit blind opnieuw verzonden. Een latere GET met
`sent_at` bevestigt de verzending; een draft zonder `sent_at` is géén bewijs dat opnieuw
verzenden veilig is. Een definitieve weigering (bijvoorbeeld 429) mag na wachttijd opnieuw
worden geprobeerd. Een reeds uitgegeven/geplande factuur wordt niet automatisch opnieuw
verstuurd, ook wanneer `sent_at` ontbreekt.

Mislukte acties krijgen oplopende wachttijden (5 minuten tot 6 uur), maximaal 20 automatische
pogingen. In Facturen zijn de verzendstatus, foutcode en een eventuele niet-bevestigde
storingsmail zichtbaar. **Automatische verwerking opnieuw controleren** plant opnieuw in,
maar verwijdert geen onzekerheidsbeveiliging. Herstel een ontbrekende koppeling of adres;
controleer een onzekere verzending eerst in Moneybird. Maak geen vervangende factuur zolang
mogelijk al een bestaande factuur aanwezig is.

Een gewijzigde foutmelding plant één beheerdersmail. De SMTP-poging wordt vooraf vastgelegd;
als de acceptatie onzeker is, wordt dezelfde melding niet blind opnieuw verstuurd.
Een mislukte melding blijft zichtbaar in het portal. Een volledige database-/hostingstoring
kan alleen in de hostinglogs worden gemeld; de worker kan dan geen betrouwbare wachtrij
lezen of bijwerken. De logs bevatten geen tokens, adressen of providerresponsen.

Een pauze voorkomt volgende create/send-acties; een reeds begonnen externe actie kan nog
worden afgerond. De worker gebruikt de beheerder die de automatisering inschakelde en
controleert diens goedgekeurde, bevestigde beheeraccount. Als die bevoegdheid vervalt,
worden verdere factuuracties geblokkeerd en verschijnt een storingsmelding. Een andere
bevoegde beheerder kan pauzeren/hervatten om de werkende beheerder te vervangen.

## Verificatie

Geautomatiseerde controles gebruiken PGlite en nep-Moneybird/SMTP, nooit echte facturen:
prospectieve toelating, klant-/anonieme weigering, workerconcurrentie, directe verzending,
contactworkflow zonder vaste betalingstermijn, dubbele POST/PATCH voorkomen, onbekende en
definitief geweigerde uitkomsten, pauze vlak vóór verzenden, gewijzigd factuuradres,
SMTP-fouten, ingetrokken beheerrechten en verlopen leases. De bestaande proefroute blijft
apart en houdt haar eigen testtekst en toestemming.
