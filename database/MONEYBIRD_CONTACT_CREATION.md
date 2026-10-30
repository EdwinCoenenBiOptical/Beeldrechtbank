# Ontbrekende Moneybird-klant aanmaken vanuit beheer

## Installeren en testen

De bestaande OAuth-verbinding en Netlify-variabelen blijven geldig. Er worden geen
extra scopes gevraagd; de gerichte contact-POST valt onder de bestaande
`sales_invoices`-toestemming. Als Moneybird de schrijfactie weigert, verschijnt een
fout; de app vraagt niet automatisch meer rechten.

Voer **eenmalig** `migrations/012_moneybird_contact_creation.sql` uit na 010 en 011.
De bestaande company/identity-migraties blijven vereist. Zonder 012 werken de oude
zoek-/koppelfuncties door en toont beheer een melding dat 012 nodig is voor aanmaak.
Geen nieuwe geheimen, prijsregels, testorders of factuurinstellingen nodig.

Test na de deployment als beheerder:

1. Open **Mijn account → Bedrijven en Moneybird**.
2. Selecteer het nieuwe testbedrijf **Bi-Optical · KvK 84957476 · Klant 2**.
3. Zoek op KvK. Wanneer de zoekopdracht geen contacten toont, verschijnt
   **Klant aanmaken in Moneybird**.
4. Controleer straat/huisnummer, eventuele adresaanvulling, postcode, plaats,
   landcode (standaard NL), factuur-e-mailadres en optionele factuurcontactnaam.
   Naam en KvK worden uit het portalbedrijf overgenomen, niet uit de browser.
5. Vink de expliciete bevestiging aan en kies **Klant aanmaken en koppelen**.
6. Controleer de opgeslagen bedrijfskoppeling en het contact in Nicole's Moneybird.
   Verwacht één nieuw contact en geen nieuwe factuur of verstuurde e-mail.
7. Vernieuw de pagina: de koppeling blijft staan; er is geen nieuwe aanmaakknop.
   Pietje deelt de bedrijfskoppeling en krijgt geen toegang tot Moneybird-beheer.

## Bescherming tegen dubbele contacten

Een private ledger heeft één record per portalbedrijf/Moneybird-administratie.
De externe klantreferentie is deterministisch `BRB-<company-uuid>`. Deze wordt als
Moneybird `customer_id` alleen aan nieuwe contacten toegekend. Bestaande contacten
of bestaande klantnummers worden niet overschreven.

Elke poging krijgt een exclusieve lease. Dubbelklikken of parallelle verzoeken
kunnen niet twee bevestigde POSTs voor hetzelfde bedrijf starten. De server zoekt
vóór een nieuwe POST op de vaste klantreferentie en vervolgens op exact KvK over
alle zoekresultaatpagina's (maximaal 100 pagina's; bij onvolledige controle stopt
hij). Een bestaand KvK wordt teruggegeven voor handmatige controle en koppeling.
Externe wijzigingen in Moneybird tijdens de controle kunnen niet transactioneel
worden vergrendeld; de bescherming coördineert onze eigen portalverzoeken.

Vóór de externe POST bewaart de server duurzaam status `sending`. Bij een timeout,
provider-5xx of onleesbare succesresponse blijft het resultaat onzeker. Een volgende
poging doet dan **geen nieuwe POST**, maar zoekt de eerdere klant op via customer_id
of het reeds opgeslagen Moneybird-contact-ID. Bij aantoonbaar afgewezen verzoeken
zoals 422 kan de beheerder gegevens corrigeren en opnieuw bevestigen.

Zodra de klant gevonden/aangemaakt is, wordt het contact-ID eerst vastgelegd en
wordt de mapping met de bestaande revisie-/auditcontrole transactioneel opgeslagen.
Als mapping mislukt, kan herstel hetzelfde contact terugvinden zonder het opnieuw
aan te maken. Als het bedrijf inmiddels anders gekoppeld is of het KvK afwijkt,
stopt de automatische koppeling voor handmatige controle.

## Onzeker resultaat

Het scherm toont **Eerdere aanmaak controleren** met de vaste klantreferentie.
Na bevestiging controleert de app uitsluitend de eerdere aanmaak en koppelt deze
zo mogelijk. Is de klant nog niet zichtbaar, probeer later opnieuw of controleer
in Moneybird en koppel een gevonden contact via de bestaande zoekfunctie.
Bij een onzeker resultaat nooit het ledger-record verwijderen of status handmatig
resetten om opnieuw een POST te forceren: dat kan dubbele contacten opleveren.

## Database en autorisatie

`private.moneybird_contact_creations` bewaart status, onveranderlijke referentie,
requestgegevens, Moneybird-contact-ID en lease. Na een mogelijk verstuurde POST
wordt de oorspronkelijke request niet meer door een nieuwe browserpayload vervangen.
Alleen bij nooit-verstuurde/expliciet afgewezen requests kunnen gegevens worden
gecorrigeerd. Requested_by/updated_at leggen de bevestigende beheerder en timing vast;
de uiteindelijke mapping heeft de bestaande private mapping-audit.

De ledger is niet leesbaar/schrijfbaar voor gewone portalgebruikers.
`admin_moneybird_contact_creation` controleert expliciete beheerrechten.
`server_moneybird_contact_creation` is uitsluitend uitvoerbaar via service_role en
controleert daarnaast de actuele beheerder, bedrijfsgegevens, lease en koppeling.
De API controleert auth en Origin vóór verwerken, vereist bevestiging en weigert
verouderde bedrijfsgegevens. De writer heeft uitsluitend POST contacts.json met een
vaste veldenlijst; geen generieke Moneybird-proxy of factuur-/bankacties.
