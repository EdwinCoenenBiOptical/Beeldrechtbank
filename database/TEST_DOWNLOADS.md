# Beveiligde testdownload

De eerste download is uitsluitend voor expliciet aangewezen OneDrive-beheerders.
Er is één mapping: voorbeeldtekening NVH-0001 naar het al gekoppelde bestand
`Rechtbanktekeningen/BeeldRechtbank/NVH-001.jpg`. Andere tekeningen of gewone
redactiemedewerkers krijgen hiermee geen toegang tot originelen.

1. Voer `migrations/005_test_downloads.sql` eenmaal uit, na de eerdere migraties.
   Het script voegt downloadregistratie en gecontroleerde RPC's toe. De bestaande
   OneDrive-koppeling en bestellingen blijven intact.
2. Wacht tot de bijbehorende Netlify-deployment Published is. Herlaad de app volledig.
3. Log als Edwin in. Open de eerste tekening 'De zitting in beeld', kies Online
   (het doel van je bestaande testbestelling). Er hoort Testbestand downloaden
   te staan onder het bewaarde testgebruiksrecht. Voor een ander doel moet eerst
   een afzonderlijke testbestelling bestaan.
4. Klik op de downloadknop. Het JPEG-bestand wordt server-side opgehaald en als
   NVH-001.jpg aan de browser aangeboden. Er gaat geen Microsoft-token of tijdelijke
   OneDrive-download-URL naar de browser.
5. Ga naar Mijn account en bekijk Downloadgeschiedenis. Klik zo nodig Downloads
   vernieuwen. Een nieuwe klik maakt een nieuwe downloadregistratie, geen extra
   bestelling. De tijden worden in Europe/Amsterdam getoond.

Het bestand mag voor deze test maximaal 3 MiB zijn, vanwege de grenzen van kleine
serverless responses. Het huidige bestand van ongeveer 1,4 MB past daarbinnen.
Grote productiebeelden vragen later een andere leveringsmethode.

De server verifieert beheerrechten, het huidige goedgekeurde profiel en een
bestaand bedrijf/testgebruiksrecht, vóór het ophalen én bij het vastleggen.
De privé-OneDrive-tokens blijven server-only versleuteld. Redirects worden alleen
naar expliciete HTTPS OneDrive-downloadhosts gevolgd, zonder Graph-bearer-token.
Bestandsformaat en een limiet op de werkelijke ontvangen bytes worden gecontroleerd.

Downloads staan als `offered` geregistreerd: de server heeft de bytes opgehaald
om aan de browser te leveren. Dit bewijst niet dat het bestand op de computer
van de gebruiker is opgeslagen. Fouten tijdens ophalen worden niet als aangeboden
bestand geregistreerd. Fouten na het versturen kunnen we niet volledig waarnemen.

Gewone medewerkers kunnen de geschiedenis van hun bedrijf bekijken, maar geen
testdownload uitvoeren of downloadgebeurtenissen rechtstreeks schrijven. Er
zijn nog steeds geen echte, facturabele bestellingen/downloads voor klanten.

## Validatie

`npm test` controleert onder meer admin-/gebruiksrechtcontrole, afgewezen toegang,
herhaald downloaden zonder nieuwe bestelling, bedrijvenisolatie, bytegrenzen en
het niet doorgeven van tokens aan CDN-hosts. Browsercontroles gebruiken een klein
JPEG-testbestand en gesimuleerde API-antwoorden. De echte OneDrive-download moet
na de migratie en deployment met het bestaande beheeraccount worden geprobeerd.
