# Moneybird: bedrijven en contactpersonen koppelen

Deze stap leest Moneybird-contacten en bewaart een gecontroleerde koppeling op
bedrijfsniveau. Er worden geen Moneybird-contacten of facturen aangemaakt,
gewijzigd of verstuurd. Testbestellingen en downloads blijven ongewijzigd.

## Instellen

1. Voer `migrations/010_moneybird_contacts.sql` uit in Supabase SQL Editor.
   Dit vereist de account- en beheermigraties 001, 004 en 007. De bestaande
   bedrijvenzoeker gebruikt 008. De mailmigratie 006 is niet nodig.
2. Maak voor Nicole's administratie een persoonlijke Moneybird API-token aan via
   de ontwikkelaarsinstellingen: <https://moneybird.com/user/applications/new>.
   Gebruik een aparte token voor deze portal en controleer de daadwerkelijk
   aangeboden rechten/scopes voordat je productiegegevens beschikbaar maakt.
   Vraag de minimaal benodigde toegang voor contacten; neem niet aan dat er een
   aparte contacts- of alleen-lezen-scope bestaat. Moneybird kan rechten groeperen.
   Als alleen ruimere boekhoudrechten beschikbaar zijn, bepaal eerst expliciet
   welke rechten nodig zijn in plaats van automatisch alles te selecteren.
   De app gebruikt in deze versie alleen GET naar de contact-endpoints, maar
   dat beperkt niet de machtigingen van een eventueel uitgelekte token.
3. Kopieer het administratie-ID uit de Moneybird-URL. Bijvoorbeeld in
   `https://moneybird.com/123456789012345678/contacts` is het lange getal het ID.
4. Zet in Netlify bij **Production**:
   - `MONEYBIRD_ADMINISTRATION_ID`: dat ID als tekst, zonder URL.
   - `MONEYBIRD_API_TOKEN`: de token, met **Contains secret values** aangevinkt.
   - `SUPABASE_SECRET_KEY`: de bestaande geheime serversleutel blijft nodig.
   Functions moet toegang hebben. Op Free is de scopekeuze vergrendeld met
   Functions al aangevinkt; de standaardinstelling is geschikt.
   Laat preview/branch/local-contexten voor deze productiegegevens leeg.
5. Deploy de nieuwe versie nadat SQL en variabelen klaarstaan. Tokens nooit in
   chat, CSV, screenshots, Git of een NEXT_PUBLIC-variabele zetten.

## Bedrijf koppelen

Open als Edwin **Mijn account → Bedrijven en Moneybird** (of via personenbeheer).
Zoek en selecteer een portalbedrijf. De Moneybird-zoekopdracht is vooraf ingevuld
met het KvK-nummer; zoeken op naam is ook mogelijk. Zoekresultaten worden per 25
getoond. Controleer het contact via **Contact controleren**. Controleer naam,
KvK, adres en factuur-e-mailadres en kies eventueel een contactpersoon uit de
contactpersonen van dat Moneybird-contact. De standaardkeuze neemt de bestaande
factuurontvanger en het factuur-e-mailadres van het Moneybird-contact over.
Een persoon zonder eigen e-mailadres valt terug op het factuuradres van het
contact; ontbrekende gegevens worden zichtbaar als ontbrekend getoond.

Bevestig de controle en sla de koppeling op. Als een KvK ontbreekt/afwijkt of de
bestaande contact-/administratiekoppeling wordt vervangen, is een reden verplicht.
Gebruik **Gekoppeld contact opnieuw controleren** om wijzigingen in Moneybird te
lezen en vervolgens bewust opnieuw op te slaan. Er is geen automatische sync.
Als een bedrijf ontbreekt, maak het voor deze eerste stap zelf in Moneybird aan
en zoek opnieuw; de portal maakt nog geen externe contacten aan.

## Bewaren en beveiliging

- Eén portalbedrijf heeft één koppeling; medewerkers delen die koppeling.
- Administratie-ID en contact-ID worden als tekst bewaard (geen afrondingsfouten).
- Optionele factuurcontactpersoon is een Moneybird-contactpersoon, geen automatisch
  aangemaakt portalaccount. Er hoeft geen persoon-op-persoonkoppeling te bestaan.
- De server leest het contact opnieuw vóór opslaan. De browser levert alleen IDs,
  versie, controlebevestiging en reden; adres-/ontvangersnapshots komen van Moneybird.
- De server gebruikt de vaste Moneybird-host en ingestelde administratie. De browser
  kan geen eigen API-host, administratie of contactgegevens injecteren.
- Nieuwe koppelingen en wijzigingen worden in private tabellen vastgelegd, inclusief
  oude/nieuwe waarden, beheerder en reden. Gewone gebruikers hebben geen toegang.
- Een Moneybird-contact kan niet aan twee portalbedrijven worden gekoppeld.
- Verouderde schermen kunnen niet een nieuwere koppeling overschrijven.
- Bij overplaatsing van een medewerker blijft de Moneybird-koppeling bij het bedrijf;
  bestaande bestellingen, gebruiksrechten en toekomstige factuurhistorie verhuizen niet.
- Deze snapshots zijn voorbereidende mappinggegevens. De factuurintegratie moet later
  opnieuw ontvanger/adres/rechten valideren en per bestelling factuurreferenties bewaren.

## Validatie

`npm test` controleert de leesclient met gesimuleerde Moneybird-antwoorden en echte
lokale PostgreSQL-rechten/constraints/audit. Browsercontrole gebruikt gesimuleerde
API-antwoorden. Echte lokale HTTP-aanroepen bevestigen dat niet-ingelogde
lezers/schrijvers worden geweigerd en wijzigingen een geldige Origin vereisen.
Zonder Nicole's API-token is live zoeken/koppelen nog niet getest.

Handmatige acceptatie na configuratie:

1. Zoek Bi-Optical op KvK en controleer de juiste Moneybird-klant.
2. Kies het bedrijf/factuurcontact en sla op; vernieuw en controleer dat het bewaard is.
3. Log in als Pietje: geen toegang tot Moneybird-beheer of de nieuwe API-routes.
4. Controleer in Moneybird dat geen contact of factuur is aangemaakt of gewijzigd.

API-referentie: <https://developer.moneybird.com/api/contacts/>.
