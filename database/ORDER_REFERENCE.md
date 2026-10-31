# Referentie van de klant / PO-nummer

Voer `migrations/014_order_customer_reference.sql` eenmalig uit na migratie 013.
Daarna kan de nieuwe app worden gebruikt; geen extra Netlify-variabelen nodig.

- Bij een **nieuwe** bestelling staat `Jouw referentie / PO-nummer · optioneel`.
- Maximaal 100 tekens; buitenste spaties worden verwijderd, lege tekst wordt NULL.
- Regeleinden/controletekens worden geweigerd. De referentie is tekst, geen prijs,
  klant-ID of mogelijkheid om bestemming, btw of factuurgegevens te overschrijven.
- Een wijziging aan het veld wist het akkoordvinkje zodat de klant opnieuw controleert.
- De waarde staat na bevestiging bij de bestelling en in de bedrijfshistorie.
- Referentie hoort bij de bestelling, niet bij iedere volgende download. Een
  bestaande bestelling/gebruiksrecht wordt nooit overschreven door een retry/collega.
- Nieuwe Moneybird-facturen krijgen het PO exact als `reference` (Kenmerk).
  Zonder PO krijgen ze het leesbare bestelnummer. Interne herstelgegevens blijven apart.
- Een al bestaand concept/factuur wordt niet aangepast. Ook de ene-factuur-proeflimiet
  blijft staan; deze wijziging activeert geen algemene automatische facturatie.

Handmatige test: kies als Edwin een gebruiksdoel waarvoor zijn bedrijf nog geen
recht heeft (bijvoorbeeld Print als alleen Online al besteld is), vul een PO in,
controleer bedrag en voorwaarden en bevestig. Controleer dezelfde waarde bij de
bestelbevestiging en Mijn account. Herladen mag geen nieuwe bestelling of gewijzigd
PO opleveren. De financiële tests controleren lokaal de exacte Moneybird-payload en
herstel wanneer meerdere bestellingen hetzelfde PO-nummer gebruiken.
