# Aanmeldingen beoordelen

Dit beheerscherm gebruikt het bestaande expliciet aangewezen beheeraccount van
Edwin. Gewone, ook goedgekeurde, medewerkers krijgen geen beheerrechten.
Notificatiemail is geparkeerd; migratie 006 en mailinstellingen zijn hiervoor
niet nodig. Domeinkoppeling blijft eveneens een aparte latere stap.

1. Voer `migrations/007_application_admin.sql` eenmaal uit na 001 en 004.
2. Wacht tot Netlify de gebundelde wijziging publiceert en herlaad de app volledig.
3. Log in als Edwin via het bestaande beheeraccount en kies Mijn account >
   Aanmeldingen beheren. De lijst opent op Wacht op goedkeuring.
4. Controleer Pietje Puk: gevraagd bedrijf Bi-Optical, KvK 77328949. Het bestaande
   bedrijf bij dit KvK-nummer is Edwin Coenen, klant 1. De medewerker wordt aan
   dit bestaande bedrijf gekoppeld; het opgegeven handelsnaamverschil wordt
   expliciet getoond. De bestaande bedrijfsnaam wordt niet automatisch aangepast.
5. Controleer de bevoegdheid en vink de verklaring aan. Goedkeuren wordt pas
   mogelijk na e-mailbevestiging. Klik Goedkeuren. Bekijk daarna ook het filter
   Goedgekeurd. Pietje kan in het andere browservenster de accountstatus vernieuwen.
6. Bij een onbekend KvK-nummer kun je een bedrijfsnaam invoeren. Een nieuw bedrijf
   krijgt een automatisch klantnummer. Er zijn nog geen tarieven voor dit bedrijf;
   die worden later in een afzonderlijk beheerscherm ingesteld.
7. Afwijzen vraagt een tweede klik. Er wordt geen automatische mail verstuurd.

Elke beoordeling controleert de beheerrol in de database, ook bij directe RPC-
aanroepen. De aanvraag wordt vergrendeld; alleen pending aanvragen zijn wijzigbaar.
Een ander KvK-nummer koppelen, goedkeuren zonder bevestigde e-mail, jezelf beoordelen
of een al beoordeelde aanvraag opnieuw wijzigen is geweigerd. Reviewer, beslissing,
bedrijf en tijdstip staan in een private auditregistratie.

## E-mailbevestiging

De bestaande PKCE-mailflow blijft werken. Als de mail in een andere browser wordt
geopend, kan automatisch inloggen mislukken terwijl de mailbox al bevestigd is.
Inloggen met het eigen e-mailadres/wachtwoord werkt dan gewoon. De foutmelding
maakt dat onderscheid nu duidelijker.

Een tweede, browser-onafhankelijke bevestigingspagina is voorbereid. Om deze later
te gebruiken, vervang in Supabase Authentication > Emails > Confirm signup de
bevestigingslink door:

```html
<a href="{{ .SiteURL }}/auth/confirm#token_hash={{ .TokenHash }}">Bevestig je e-mailadres</a>
```

Pas dit pas toe nadat de nieuwe deployment gepubliceerd is. De nieuwe link is
voor nieuwe mails; eerder verzonden mails gebruiken nog de oude flow. Op de
nieuwe pagina klikt de gebruiker expliciet op E-mailadres bevestigen en logt
vervolgens met het eigen wachtwoord in. Mailvoorvertoningen/scanners voeren geen
verificatie uit door alleen de pagina op te vragen. Het tokenfragment wordt uit
de adresbalk verwijderd; de API geeft geen toegangstokens terug, vervangt geen
bestaande browsersessie en keurt geen accounts goed. Wachtwoordherstel blijft
voorlopig de bestaande flow gebruiken.

## Deployments beperken

Netlify toonde 15 credits per production-deployment in deze omgeving. Daarom
worden wijzigingen lokaal gebouwd en getest, en gebundeld in één push voor de
hele werkstap. Commits kunnen lokaal tussentijds worden gemaakt zonder een
Netlify-build. Verbruik en planregels moeten in het eigen Netlify-dashboard
worden gecontroleerd; automatische upgrades worden niet door deze code ingesteld.
