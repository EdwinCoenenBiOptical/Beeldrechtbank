# Eén gecontroleerde factuurproef in Moneybird

## Installatie

Voer **alleen migratie 013** (`migrations/013_moneybird_invoice_trial.sql`) uit in
Supabase SQL Editor, na de bestaande account-, bestel- en Moneybird-migraties.
Dit vereist 001–004, 007, 010 en 011; 012 blijft voor klantaanmaak. Geen nieuwe
Netlify-variabelen, mailmodule, cronjob of bredere OAuth-scopes nodig.

De app gebruikt de bestaande `sales_invoices`-toestemming om btw-/omzetkeuzes te
lezen en één eigen testbestelling naar een concept en expliciet bevestigde
verzendopdracht om te zetten. Als Moneybird instellingen niet laat lezen of
schrijven, verschijnt een fout; er wordt niet automatisch meer toegang gevraagd.

## Handmatige test

1. Wacht op de nieuwe Netlify-deployment en vernieuw de portal.
2. Log in met Edwin's expliciete beheeraccount. Open **Mijn account → Factuurproef**
   (ook bereikbaar via Bedrijven en Moneybird).
3. Selecteer een **eigen bestaande testbestelling**, bijvoorbeeld Testbestelling 1
   namens het oorspronkelijke bedrijf. Alleen bestellingen die dit beheeraccount
   zelf heeft geplaatst zijn voor deze proef beschikbaar. Pietjes bestellingen
   worden niet aangeboden. Er is één proefslot per Moneybird-administratie.
4. Laad de btw-tarieven en omzetcategorieën. Kies het normale Nederlandse 21%-
   verkooptarief en de juiste omzetcategorie voor de tekeningen.
5. Klik **Factuurgegevens controleren**. Controleer klant/adres, bedrag en ontvanger.
   De ontvanger moet exact het e-mailadres zijn van de beheerder die de bestelling
   heeft geplaatst; andere ontvangers worden door de server geweigerd.
6. Bevestig de controle en kies **Conceptfactuur aanmaken**. Dit maakt een echt
   Moneybird-concept aan, zonder verzendopdracht. Prijzen en 21% btw komen uit de
   oorspronkelijke bestelling, niet uit de browser of actuele prijsregels.
7. Open het concept in Moneybird. Controleer regels, omzetcategorie, 21% btw,
   totaal en factuurontvanger. Eventuele afwijkingen blokkeren de app-verzending.
8. Bevestig afzonderlijk dat het concept is gecontroleerd en kies **Eén testfactuur
   naar mij versturen**. Alleen dan wordt een PATCH send_invoice verstuurd, met
   expliciet één eigen e-mailadres en zonder samenvoegen van andere facturen.
9. Controleer in Moneybird de verzending/aflevering en daarna je mailbox. De app
   registreert Moneybirds status, geen bewijs dat een e-mail is gelezen.
10. Crediteer de verstuurde proef **handmatig in Moneybird**. De originele factuur
    en creditfactuur blijven in de boekhouding staan. De app crediteert niet en
    markeert niets kunstmatig als betaald.

Bestaande testorders worden niet automatisch verwerkt. Eén bewuste selectie en
controle vormt de uitzondering voor deze proef. Andere bestellingen en herhaalde
downloads hebben geen factuuractie. Het slot blijft ook na crediteren bezet; dit is
nog geen algemene productiefacturatie. Verwijder het concept tijdens de proef niet:
de app maakt voor een verwijderd vastgelegd concept geen automatische vervanger.

## Financiële controles

- Bestaande order, oorspronkelijke company_id en opgeslagen EUR-regels zijn leidend.
- Geld wordt in hele centen vergeleken; API-prijzen worden als decimale tekst verstuurd.
- De actuele Moneybird-contactkoppeling en het KvK/adres worden voor het concept
  opnieuw gecontroleerd; alleen actieve Nederlandse verkoop-btw van 21% en een
  omzetrekening uit Moneybird kunnen worden gekozen.
- Het concept moet exact dezelfde referentie, klant, persoon, valuta, regels,
  prijzen, btw-codes, omzetcodes en totalen bevatten. Een wijziging blokkeert verzending.
- De gecontroleerde conceptversie heeft een hash. Vlak voor verzenden wordt opnieuw
  gelezen en gecontroleerd. Een gewijzigde versie vereist opnieuw controle.
- Een externe gebruiker kan Moneybird tijdens deze checks wijzigen; de Moneybird-API
  biedt hier geen door ons bevestigde atomische versiecheck. We lezen direct vóór
  de verzending opnieuw en blokkeren waargenomen verschillen.
- De expliciete e-mailoverride voor de proef moet het eigen geverifieerde
  beheer-e-mailadres zijn, ongeacht latere standaardontvangers in Moneybird.

## Dubbele acties en herstel

`private.moneybird_invoice_trials` heeft één administratie als primaire sleutel en
één unieke order-ID. De vaste referentie is `BRB-PROEF-<order-uuid>`.
Een exclusieve lease en duurzaam opgeslagen actie-intentie beschermen tegen
parallelle clicks en retries. De server controleert bestaande Moneybird-facturen
op deze exacte referentie voordat een nieuwe concept-POST mogelijk is.

Na een mogelijk geslaagde conceptaanmaak volgt nooit een blinde tweede POST.
**Factuurstatus controleren** zoekt de eerdere aanmaak of leest het bekende ID.
Na een mogelijk geslaagde verzendopdracht blijft een onomkeerbare unresolved-fence
actief. Zelfs als een volgende GET nog 'draft' toont, wordt niet opnieuw verstuurd.
Pas een aantoonbaar afgewezen HTTP-verzoek mag na controle opnieuw worden bevestigd.
Bij uitgifte/verzending wordt de lokale sent-fence permanent opgeslagen.

Een fout of afwijkend bedrag betekent: concept en Moneybird controleren, niet
het proefrecord verwijderen of de status handmatig resetten. Bij een onzeker
resultaat kan Moneybird de actie al uitgevoerd hebben. Zoek eerst de bestaande
factuur op. Het beheer toont een zakelijke Moneybird-link, geen publieke factuur-
of betaallink. Factuurnummer/status worden bij de bedrijfsbestelling getoond.
De creditering zelf wordt in deze eerste stap nog niet automatisch gereconcilieerd.

## Beveiliging en audit

Normale gebruikers hebben geen toegang tot financiële beheer-API's of private
proeftabellen. Writes vereisen een goedgekeurde, bevestigde expliciete beheerder,
eigen testorder, same-origin POST, expliciete bevestiging en servervalidatie.
De service-RPC controleert deze identiteit opnieuw en bewaart plan/status/events.
Alleen eigen bedrijfsleden zien het beperkte factuurnummer/status bij hun order;
ze krijgen geen Moneybird-token, openbare factuurlink of andere administratiegegevens.
Tokens blijven via bestaande OAuth-opslag versleuteld. Er is geen generieke API-proxy,
bankactie, automatische e-mailworker of automatische verwerking van testorders.

## Validatie

Lokale PostgreSQL-tests controleren permissions, oorspronkelijke order, exact geld,
zelfontvanger, één proefslot, stale review, verloren create/send-antwoorden,
herstel zonder herhaalde writes, audit en bedrijfsafscherming van de historie.
Browsercontroles simuleren Moneybird-antwoorden en controleren de twee aparte
bevestigingen, bedragen, ontvanger, link, credit-herinnering en verdwijnen van de
verzendknop. Echte lokale HTTP-checks weigeren ontbrekende login en Origin.
Live Moneybird-aanmaak/verzending wordt pas met de bovenstaande handmatige proef
uitgevoerd; er zijn tijdens de ontwikkeling geen facturen aangemaakt of verstuurd.
