# RAIDE — riippumattomat julkaisuportit

**Red-team QA / 22.11.2026**  
Kohde: RAIDE, suomalaisen junaliikenteen tilannekuva ja sitä täydentävät aikataulu-, sijainti- ja muutostietonäkymät.

Tämä tarkastus ei anna lupaa käyttää sovellusta liikenteen turvallisuuskriittisessä ohjauksessa. Digitrafficin julkinen data ei anna todennettua raidevarausta, opastintilaa, vaihteen asentoa eikä liikennöintilupaa.

## 1. Ehdottomat hyväksymisehdot

| Portti                            | Hyväksymiskriteeri                                                                                                          | Nykyinen näyttö                                                      | Tila           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------- |
| **D1 — Junan identiteetti**       | Sama numero eri lähtöpäivänä on eri juna kaikissa näkymissä.                                                                | `operational-acceptance.test.ts`                                     | Läpäisty       |
| **D2 — Suomen aika**              | Kesä-/talviaika ja UTC-vuorokausirajat eivät muuta lähtöpäivää vääräksi.                                                    | `localDate`, `time`, `date` regressiotestit                          | Läpäisty       |
| **D3 — Aikaeron totuus**          | Toteuma ohittaa ennusteen; tuntematon/peruttu ei ole `0 min`.                                                               | `rowDeviation`, `delay` regressiotestit                              | Läpäisty       |
| **D4 — Reitin jäsenyys**          | Yhteiset alkuasemat eivät yksin liitä junaa väärälle haararataosalle.                                                       | Helsinki–Pasila → Turku -vastatesti                                  | Läpäisty       |
| **D5 — Sijainti**                 | Näytä GPS vain aikaleimattuna havaintona; vanha GPS merkitään vanhaksi, ei ennusteta liikettä.                              | `buildTrainProgress` testit; asemalle saapunut ≠ seuraava asema      | Läpäisty       |
| **D6 — Havaintohistoria**         | Muutos havaittiin kahden näytteen välissä; myöhemmän näytteen aika ei ole tapahtuman vahvistettu syntyaika.                 | `compareSnapshots` ja `summarizeChanges`                             | Läpäisty       |
| **D7 — Muutostutkan yhtenäisyys** | Samassa aikaikkunassa tapahtumasyötteen määrä ja aikapalkkien summa täsmäävät myös aikarajalla.                             | Regressio havaintohetkellä täsmälleen bucket-rajalla                 | Läpäisty       |
| **D8 — Lähdekohtainen vika**      | GPS- tai tiedotepalvelun 503 ei hävitä onnistuneita live-aikatauluja; aikataulun 503 ei näytä tyhjää onnistumisena.         | `RailService` erilliset vikaskenaariot                               | Läpäisty       |
| **I1 — Yhtenäinen junan valinta** | Kartta, Ratakaavio, Muutostutka, Junan eteneminen ja analyysi osoittavat samaan `departureDate/trainNumber`-identiteettiin. | Mallitasolla tutkittu neljä näkymää; UI-vaellus tarvitsee selaimen   | Osittain       |
| **I2 — Tiedon lähde/ikä**         | Jokainen kriittinen tieto kertoo aikataulu/ennuste/toteuma/GPS/tallenne ja havaintoajan; vanhaa ei vihjata nykyiseksi.      | Osittain yksikkötesteissä, koko UI tarkastettava                     | Osittain       |
| **I3 — Näppäimistö**              | Kaikki toiminnot ovat käytettävissä ilman hiirtä; ei kohdistusansaa laajennetussa näkymässä.                                | Työpöytäselaimen tehtävätesti tarvitaan                              | Testaamatta    |
| **I4 — Animaatiot**               | `prefers-reduced-motion` toimii, tila ei välähdä kuormituksessa eikä mikään liike esitä keksittyä GPS-paikkaa.              | Koodikatselmointi ja selaintarkastus tarvitaan                       | Testaamatta    |
| **U1 — Eri näytöt**               | Ei ylivuotoa tai leikkautuvaa toimintoa 390×844, 768×1024, 1366×768 ja 1920×1080.                                           | 1.4:ssä tarkastettu 1363×936; uusi rakenne vaatii oman tarkastuksen  | Testaamatta    |
| **P1 — Kuorma**                   | 200 junaa / vähintään 5000 aikatauluriviä, valinta ja suodatus reagoivat sujuvasti.                                         | Mallin 200/5000 laskenta läpäisty alle 1500 ms; UI/paint mittaamatta | Osittain       |
| **S1 — Ohjausraja**               | Ei väitteitä todellisista vaihde-, opastin-, raidevaraus- tai liikennöintilupatiloista.                                     | Käsite- ja tekstikatselmointi; hyväksytyn datan rajat                | Jatkuva portti |

- D7-testissä paljastui virhe: täsmälleen nykyhetken bucket-rajaan sijoittuva havainto näkyi yhteenvetoluvussa mutta putosi graafisesta aineistosta. Innovaatiokehittäjä korjasi kattavat aikarajat, päätepisteen indeksoinnin ja valitun aikaruudun tapahtumahaun.
- D5-testissä paljastui alkuperäinen semantiikkavirhe: juna on jo saapunut asemalle mutta lähtöä ei ole vahvistettu — asemasta ei saa puhua seuraavana pysähdyksenä. Etenemismalli erottaa nyt viimeisimmän vahvistetun saapumisen, tämänhetkisen asemapisteen ja seuraavan aikataulupisteen.
- **Uudelleenajo 22.11.2026:** `npm test -- --run` **109/109 vihreää**, mukaan lukien oma `operational-acceptance.test.ts` **20/20 vihreää**. `npm run build` **läpäisty** (myös Storybook), ja myöhempi `npx tsc --noEmit` **läpäisty**. Tiheystesti tarkastaa identiteetin ja summat 200 junalla / 5000 aikataulurivillä sekä varmistaa alle 1500 ms puhtaan laskennan; se ei todista animaatioiden tai selaimen maalausnopeutta.

## 2. Testattavat ammattilaisen tehtäväpolut

### Tilanteen löytäminen 10 sekunnissa

1. Avaa tilannekuva ja valitse rataosa.
2. Löydä _havaittu_ merkittävä aikataulu-/viivemuutos ilman tiheän viivakimpun lukemista.
3. Avaa siihen liittyvä juna.
4. Tarkista **mikä muuttui**, vanha ja uusi lähdetieto sekä havaintoajankohta.
5. Näytä samasta junasta lähtö, viimeinen vahvistettu asemapiste, viimeinen GPS-havainto (jos käytettävissä), seuraava aikataulupiste ja määränpää.

**Läpäisy:** käyttäjä osaa erottaa havainnon, ennusteen ja aikataulun sekä tiedonpuutteen ilman ulkopuolista selitystä. Operatiivisen käyttäjän oikea käytettävyystesti on vielä järjestämättä.

### Poikkeuksen ja epävarmuuden näyttäminen

- Junan asematapahtuma on peruttu, mutta myöhempi reitti jatkuu: ei lasketa tapahtumaa saapumiseksi eikä muuteta puuttuvaa ennustetta nollaksi.
- Edellisen aseman toteuma +19 min, seuraavalla asemalla ei ennustetta: seuraavaa asemaa ei merkitä +19 min myöhäiseksi ennusteen tavoin.
- GPS on 20 minuuttia vanha: havainto saa aikaleiman ja **Vanhentunut**-tilan; ei siirretä junamerkkiä oletettuun uuteen paikkaan.
- GPS puuttuu tai sen rajapinta kaatuu: live-aikataulut pysyvät näkyvissä, mutta kartan lähdetila kertoo puutteen.
- Kaksi junaa on samaan aikaan saman liikennepaikan aikatauluikkunassa: näytä samanaikaiset tapahtumat, **älä päättele fyysistä konfliktia**.

## 3. Tarkastuksen suoritus ja toistettavuus

```sh
npm ci
npm test
npm run build
npm run test:e2e
```

`src/operational-acceptance.test.ts` sisältää tietomallin rajatestit: lähtöpäivä, Suomen aikavyöhyke, ennuste/toteuma/tuntematon, reitin haaran jäsenyys, GPS:n ikä/identiteetti/koordinaatit, asemapisteen/edessä olevan aseman erottelu, peruutus, eri näkymien junan identiteetti, havaintohistoria, palveluiden erillisviat ja 200 junan / 5000 aikataulurivin laskentatesti.

**Selaintestausraja:** `npm run test:e2e` ajettiin uudelleen 22.11.2026: **13/13 estyi jo Chromiumin käynnistyksessä** (`FATAL ... socket() failed: Operation not permitted (1)`). Kyse on ympäristön selaimen käynnistysesteestä, **ei 13 todetusta sovellusvirheestä eikä 13 läpäistystä testistä**. Aiempi manuaalinen työpöytätarkastus 1363×936 ei todista uuden julkaisun mobiili- tai täysresoluutiotoimintaa. Testit tulee ajaa oikeassa Chrome/Edge-ympäristössä.

## 4. Julkaisun estävät löydökset ja regressioiden omistus

| Havainto                                                              | Vakavuus                                                | Omistaja                | Sulkemisehto                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| Muutostutkan histogrammin bucket-rajan täsmällinen tapahtuma puuttui  | P1 — suljettu                                           | Innovation Engineer     | Histogrammi ja aikaruudun sisältö nyt raja-arvossa sama                                        |
| Muutostutkan muutostyyppirajaus ei rajannut histogrammia              | P1 — suljettu                                           | Innovation Engineer     | `radarViewData` tuottaa suodatetun histogrammin ja lokin; erillinen regressiotesti vihreä      |
| Valitun junan identiteetti voi vaihtua suodatustyöntekijän tuloksesta | P1 — lähdekoodi korjattu, selainvarmistus puuttuu       | Integration Engineer    | `main.ts` säilyttää valinnan suodattimen yli; lopullinen vuorovaikutustesti tarvitsee selaimen |
| Uusien näkymien johdonmukainen valinta ja lähteiden tuoreus           | P1                                                      | Integration / QA        | Selaintesti ja manuaalinen todiste                                                             |
| Mobiili-, zoom- ja suurtiheysnäkymien ylivuoto                        | P1                                                      | Design / HMI            | 390/768/1366/1920-ruudunkaappaukset ja kosketustestit                                          |
| Käyttäjän tehtäväpolun läpimeno oikealla rautatiealan ammattilaisella | P1 ennen operatiiviseen työhön soveltuvaksi väittämistä | Product / user research | Tehtäväpohjainen käytettävyystesti, virhehavainnot kirjattu                                    |

**Päätössääntö:** tekninen demo voidaan julkaista selvästi rajattuna tietojen seuranta- ja portfolio-sovelluksena, kun automaattitestit, rakennus ja vähintään työpöydän pääpolku toimivat. Sitä ei saa kutsua turvallisuuskriittisesti validoiduksi eikä viralliseksi liikenteenohjausjärjestelmäksi.
