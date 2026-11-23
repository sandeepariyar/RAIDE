# Tarkastukset

## Versio 1.7 — tietojen oikeellisuus ja työtilan uudistus

- **143/143 Vitest-testiä läpäisty.** Uudet regressiot kattavat puuttuvia aiempia havaintoja, väärään asemaan palaavan seuraava-/nykytila-arvion, oletetun reittiyhteyden ohittavat pikajunat, kaaviosta putoavan junamäärän, tuntemattoman viiveen ja osittaisen live-aikataulun. Mukana on viisi aidon tallenteen IC 63/65/67/68/70 -junien jatkuvuustestiä.
- **TypeScript strict, Viten tuotantorakennus ja Storybook-rakennus läpäisty.**
- Reittiverkossa on sovitus, valitun junan seuraaminen, korjattu ylivuotoryhmittely, eroteltu peruutus/ennuste/tuntematon ja suunnittaiset määrät. Ohitetut aikataulupisteet esitetään katkoviivaisena selvittämättömänä jaksona, ei ratayhteytenä tai raidevarauksena.
- Sovelluksen tärkeimmissä työtiloissa on koko näytön painike: selaimen Fullscreen API ja tarvittaessa sivun laajennettu työtila. Rajatun tietolähteen, tallenteen ja vanhentumisen tila säilyy näkyvissä myös pienessä käyttöliittymässä. Hakutulokset voidaan valita ja paikantaa reittiverkossa.
- **21 Playwright-selaintestiä määritelty ja testiluettelo tarkastettu, mutta ei ajettu läpi selaimessa tässä ympäristössä.** Aiempi hallittu esikatseluselaimen osoiterajoitus ja Chromiumin socket-estyminen estävät uuden työtilan visuaalisen hyväksymistestin; 390/768/1366/1920 px, aito koko näytön palautus, kosketus, ruudunlukija ja live-rajapinta vaativat erillisen selaintarkastuksen ennen operatiivista käyttöä.
- Julkaistu tilannekuva on analyysi- ja portfoliosovellus. Se ei ole liikenteenohjauksen turvalaite eikä näytä todellisia ratavaraus- tai opastintiloja.

Tarkastettu 23.11.2026.

## Versio 1.6 — Elävä reittiverkko

Tarkastettu 22.11.2026.

- **130/130 Vitest-testiä läpäisty**, joista 9 uutta reittiverkon mallikoetta, 10 riippumatonta dynaamisen kaavion hyväksymiskoetta ja 2 uutta reaaliaikaisen junakattavuuden regressiotestiä.
- Julkaistujen reittipisteiden toteuma, ennuste, aikataulu, peruutus ja tuntematon viive pidetään erillisinä; yksittäisen junan GPS-paikkaa ei ekstrapoloida tai sijoiteta keksitylle raideosuudelle. Myös yön yli liikennöivä GPS:tön palvelu voi tulla mukaan `/live-trains`-tiedoista.
- **Vite-tuotantorakennus, Storybook-rakennus ja TypeScript strict läpäisty.** Erillinen 17. Playwright-testi on lisätty kattamaan reittiverkon rataosavalinta, mittakaava ja tallenteen aikasiirto.
- **Uutta reittiverkkoa ei ole varmennettu selaimessa.** Hallittu esikatseluselaimen päivitys estyi ympäristön URL-käyttöoikeussäännöstä, eikä sitä yritetty kiertää. Paikallisen Chromiumin Playwright-käynnistys on myös aiemmin estynyt ympäristössä. Tämän version visuaalinen, kosketus- ja näppäimistökäytön tarkastus on edelleen avoin ennen muuta kuin portfolio-/analyysiesittelyä.
- Lähde- ja toiminnallisuusrajat on dokumentoitu [Elävän reittiverkon hyväksymisehtoihin](LIVE_SCHEMATIC_ACCEPTANCE.md).

## Versio 1.5 — uusi riippumaton tarkastuskierros

- **109/109 Vitest-testiä läpäisty**, mukana 20 riippumatonta operationaalista regressiotestiä. Testit sisältävät Suomen aika- ja lähtöpäivärajat, 200 junan / 5000 aikataulurivin mallilaskennan, GPS:n lähdeiän, muutostutkan aikarajat ja suodatuksen, asemalle saapumisen ja seuraavan pysähdyksen erottelun, palveluiden erillisviat sekä junan identiteetin eri näkymissä.
- TypeScriptin strict-tarkistus sekä Viten ja Storybookin tuotantorakennus **läpäisty**.
- Hallitussa 1363 × 936 -selainesikatselussa tarkastettu uuden ilmeen Tilannekuva-, Muutostutka- ja Junan eteneminen -työtilat. Muutostutkan kapean asiayhteyskortin 4-sarakkeinen tekstin ylivuoto korjattu 2-sarakkeiseksi ja tarkastettu uudelleen. Sivulla ei havaittu vaakaylivuotoa tällä leveydellä.
- **16 Playwright-selaintestiä määritelty** (13 aikaisempaa + 3 uutta muutos-/valinta-/mobiilitestiä). Tässä ympäristössä Chromiumin käynnistys kaatuu socket-käyttöoikeuteen; selaintestejä ei voi merkitä läpäistyiksi. Uudet kolme testiä eivät olleet mukana aiemmassa 13 testin estymisajossa.
- 390 × 844, 768 × 1024 ja 1920 × 1080 eivät ole visuaalisesti todennettuja tässä julkaisukierroksessa. Näppäimistön ja kosketuksen todellinen käyttäjätestaus sekä operatiivisen henkilöstön käytettävyystesti ovat avoimia portteja. Katso [riippumattomat julkaisuportit](QA_RELEASE_GATES.md).

Alla oleva aikaisemman version tarkastus on säilytetty jäljitettävyyden vuoksi.

## Automaattiset tarkastukset

- 65 tietomallin, tietopalvelun, havaintohistorian, rataosien ja aikataulun aggregoinnin testiä. Testeissä myös GPS-palvelun erillinen häiriö, viiveen tuntemattomuus, peruutetut asematapahtumat, kelloon tasattu viivekartta ja eri rataosien päällekkäisten runko-osuuksien erottelu.
- TypeScriptin strict-tyyppitarkastus.
- Viten tuotantoversio ja Storybookin staattinen rakennus.
- axe-core: tilannekuvan WCAG 2 A/AA- ja WCAG 2.1 A/AA -säännöissä 0 havaittua rikkomusta, 28 läpäistyä tarkistusta. Yksi tarkistus vaati manuaalista arviota. Tämä ei ole saavutettavuussertifiointi.

## Selaimessa tarkastettu

Uudelle versiolle on 13 `e2e/raide.spec.ts`-selaintestiä, mukaan lukien ratakaavion avaaminen, laajentaminen, junavalinnan yhtenäisyys, viivekartan tilat ja paneelien korkeuksien vertailu. **Näitä testejä ei merkitä läpäistyiksi tässä ympäristössä:** Playwrightin oma Chromium Headless Shell -tiedosto puuttuu, ja järjestelmän Chromiumin käynnistys estyy socket-oikeusrajoitukseen. Yksikkötestit, TypeScript, Viten ja Storybookin tuotantorakennukset läpäisevät. Selaintestit voi ajaa normaalissa kehitysympäristössä: `npx playwright install chromium` ja `npm run test:e2e`.

Erillisessä hallitussa selainesikatselussa tarkastettiin 22.11.2026: päänäkymän vasemman ja oikean paneelin korkeudet (1363 × 936), viiden liikennenäkymän valinnat, uusi ratakaavion renderöinti ja viivekartan ruutujen `0` / `?` / `·` -erottelu. Tämä on manuaalinen havainto, ei läpäisty Playwright-kulkutestisarja.

- Reaaliaikainen Digitraffic-aineisto latautuu selaimessa ilman API-avainta.
- Junan valinta päivittää kartan ja tietopaneelin.
- Liikennelajin ja junan haku suodattavat aineistoa.
- Tallenne käynnistyy, keskeytyy ja siirtyy loppuun. Toistonopeuden valinta toimii.
- Junan kokoonpano näyttää rajapinnasta saadut vaunut ja veturin.
- Tiedotteet ja voimassaolot avautuvat.
- Komponenttikirjaston aikaeron muutos päivittää oikeaa Lit-komponenttia.
- Ctrl+K siirtää kohdistuksen hakuun.
- Escape sulkee aineiston tiedot ja palauttaa kohdistuksen.

## Tulkinnan rajat

Pohjakartan yhteydet ovat aikatauluista johdettuja ja graafisen aikataulun etäisyydet koordinaateista arvioituja. Rataverkon turvallisuuteen liittyviä tiloja ei esitetä pääteltyinä. Tuotantokäyttö liikenteenohjauksessa ei kuulu tämän portfolio-sovelluksen tarkoitukseen.
