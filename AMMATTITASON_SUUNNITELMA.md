# RAIDE — polku ammattitason tilanneanalyysisovellukseksi

Päivitetty 22.11.2026 · Suunnittelu ja toteutus: **Sandeep Pariyar**

## Tuotteen rajaus

RAIDE on **rautatieliikenteen tilanneanalyysin ja käyttöliittymätekniikan referenssisovellus**. Sen kohderyhmä ovat ammattilaiset, jotka tarkastelevat junaliikenteen avoimeen aineistoon perustuvaa tilannekuvaa, ja suunnittelijat, jotka rakentavat vastaavia käyttöliittymiä. RAIDE ei anna ajolupia, ohjaa vaihteita, näytä todellisia opastintiloja, vahvista ratakapasiteettia tai korvaa liikenteenohjausjärjestelmää.

Tietojen lähde on Fintraffic / Digitraffic. Avoimessa aineistossa voi esiintyä puutteita ja virheitä; tietoa ei saa tulkita turvallisuuskriittisenä päätöksentekoperusteena.

## Tämän toimituksen ominaisuudet

- Junan tutkiminen: havaittujen viiveiden valinta, valitun junan seuraava pysähdys, ennusteet, toteumat, aikataulupoikkeamat ja yhdistetyt matkustajatiedotteet.
- Havaintohistoria: tallenteen peräkkäisten havaintokehysten tai nykyisen selainistunnon päivitysten vertailu. Toteuma-, ennuste-, raidenumero- ja peruutustilan muutokset voidaan rajata junan mukaan ja viedä JSON-muodossa.
- Kuusi synkronoitua aikataulunäkymää: **Aika–paikka**, **Viivekartta**, **Junien aikajanat**, **Asemamatriisi**, **Poikkeamat**, **Liikennevirta**. Junan valinta yhdistää näkymät.
- Viisi synkronoitua liikenteen yleisnäkymää: **Kartta**, **Linjakaavio**, **Ratakaavio — periaatekuva**, **Rataosat**, **Junan kulku**. Valittu näkymä ja rataosa säilyvät paikallisesti. Kaavion junamerkit perustuvat aikataulupisteisiin, eivät todelliseen raidevaraukseen.
- Käyttäjäkohtaiset näyttöasetukset: junien määrän ja tunnusten rajaaminen, piirtotasot, valitun junan tarkennus, aggregoinnin mittari, aikajanan järjestys, liikennepaikka ja aikajakso. Asetukset voi palauttaa.
- Reaaliaikainen API-haku ja mukana toimitettu toistettava aineisto ovat erilliset, tunnistettavat tilat.
- Yhteensä 65 yksikkö- ja palvelutestiä sekä TypeScriptin strict-tarkastus ja tuotanto- ja Storybook-rakennus. Selaintestit on määritelty mutta niiden Playwright-ajon estää tämän suoritusympäristön selainrajoitus.

**Kansainvälinen lähtöaineisto:** [KANSAINVALINEN_RAUTATIEVERTAILU.md](KANSAINVALINEN_RAUTATIEVERTAILU.md). Vertailussa Japani, Yhdistynyt kuningaskunta, Yhdysvallat, Australia, Saksa, Alankomaat ja Ranska. Julkinen kuvaus operatiivisesta järjestelmästä ei anna oikeutta tulkita, että RAIDE näyttäisi sen turvallisuuskriittisiä tietoja.

Havaintohistoria ei ole täydellinen tapahtumaloki: päivitys, joka tapahtuu kahden näytteen välissä ja palautuu ennalleen ennen seuraavaa näytettä, voi jäädä huomaamatta. Aikaleima on **havaitsemisaika**, ei muutoksen tarkka tapahtuma-aika. Reaaliaikaisen tilan historia säilyy vain avoimessa selainistunnossa. Tallenteen historia kattaa ainoastaan pakettiin kuuluvan havaintojakson.

## Tärkeysjärjestys

| Taso | Puute / parannus                                    | Valmistumiskriteeri                                                                                                                                                                                                                            |
| ---- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0   | Reaaliaikaisen aineiston aikaleima- ja tuoreusmalli | Kullekin tietolajille erilliset `receivedAt`, lähteen aikaleima, vanhenemisraja ja viimeisen onnistuneen haun tila; vanhentunut aineisto näkyy selvästi.                                                                                       |
| P0   | Rajapintojen skeemavalidointi                       | Virheellinen vastaus, puuttuva kenttä ja epäkelpo koordinaatti hylätään hallitusti; tiedotteen virhe ei kadota junatietoja.                                                                                                                    |
| P0   | Toistettava selaintestaus                           | Playwrightin kulkutestit: valitse viivästynyt juna → tarkastele aikataulua → vaihda näkymää → palaa → tarkastele historiaa → vie JSON. Testataan Windows/Chrome ja vähintään yksi toinen selain.                                               |
| P0   | Yhteyskatkot ja palautuminen                        | Viimeinen onnistunut aineisto säilyy, katkon kesto näkyy, automaattinen uusi yritys käyttää rajattua viivettä eikä tee päällekkäisiä hakuja. Testit 429/500/503/offline/timeout.                                                               |
| P0   | Laadun portit                                       | CI: yksikkötestit, TypeScript, lint, muodollinen koodityyli, saavutettavuuden automaattitesti, kriittisen polun selainkuvat. Kaikki portit vihreinä ennen julkaisua.                                                                           |
| P1   | Tarkat ratakilometrit                               | Selvitetään Fintrafficin Infra-API:n vastaavuus aikataulupaikkoihin; korvataan koordinaattipohjaiset etäisyysarviot todellisilla ratakilometriketjuilla vain todistetusti vastaavilla osuuksilla. Muussa tapauksessa näytetään edelleen arvio. |
| P1   | Häiriötilanteen vertailu                            | Kahden tai useamman junan ennuste- ja toteumareittien rinnastus; valittava aikaikkuna ja liikennepaikkajakso. Ei päätellä raiteiden varauksia tai todellisia konflikteja avoimesta sijaintiaineistosta.                                        |
| P1   | Tiedotteiden relevanssi                             | Erota suoraan junalle osoitetut tiedotteet ja reitin liikennepaikkoihin liittyvät yleiset tiedotteet. Lisää lajittelu, ryhmittely ja voimassaolon ymmärrettävä käsittely.                                                                      |
| P1   | Ammattilaisille sopiva vuorovaikutus                | Haun ja suodattimien pysyvyys, jaettava URL-valinta, näppäimistön työnkulut, tyhjän/virheellisen aineiston erikoistilat, käyttöliittymän tiheystasot.                                                                                          |
| P1   | Suorituskyky                                        | Mitataan 95. prosenttipisteen reagointiaika, kartan päivityksen viive, Web Workerin läpimeno ja muistin käyttö täysillä päiväaineistoilla. Asetetaan mitatut budjetit ennen optimointia.                                                       |
| P1   | Design system -toteutus                             | Kattavat Storybook-esimerkit myös tilanneanalyysin riveille ja aikataulunäkymille; semanttiset värit, komponenttien tilat, näppäimistökäyttö ja dokumentoidut rakenteet.                                                                       |
| P2   | Pysyvä havaintohistoria                             | Palvelin kerää hyväksytyt ja aikaleimatut lähdehavainnot; tietovarasto, säilytysaika, lähdeversio ja hakurajapinta. Ero havaintojen ja varmistettujen liikennetapahtumien välillä säilyy.                                                      |
| P2   | Jaettavat tarkastelut ja auditointi                 | Käyttäjähallinta, roolit, omat kirjaukset, jäljitettävä muutoshistoria, tietoturva-arvio ja tietosuojaperiaatteet. Ei synkronointia virallisiin liikenteenohjaustoimintoihin ilman erillistä lupaa.                                            |
| P2   | Operatiivisen integroinnin selvitys                 | Todelliset tietotarpeet, roolit, SLA, rajapintaluvat ja integraatiot määritellään yhdessä organisaation kanssa. Mahdollinen tuotantohyväksyntä on erillinen hanke.                                                                             |

## Graafisen aikataulun visualisointien työnjako

1. **Aika–paikka**: junapolkujen eteneminen. Oletuksena piirretään enintään 24 ensisijaista junaa ja muut saa valita asetuksista; aikataulu ja havaintotiedot ovat eroteltavissa. Etäisyydet ovat koordinaattipohjaisia arvioita.
2. **Viivekartta**: liikennepaikat × 15 minuutin aikaikkunat, mittarina myöhässä olevien junien määrä, vain positiivisten viiveiden keskiarvo tai junien kokonaismäärä. Solun valinta avaa siihen liittyvät junat. Tuntemattomat aikaerot erotetaan nollasta.
3. **Junien aikajanat**: yksi juna omalla rivillä. Aikataulujakso ja ennuste-/toteumajakso ovat erillään, valinta siirtyy muihin näkymiin; usean junan näkymä sivutetaan.
4. **Asemamatriisi**: liikennepaikat riveillä, junat sarakkeissa, solussa toteuma tai ennuste sekä aikatauluaika. Hyödyllinen saman osuuden monen junan nopeaan vertailuun.
5. **Poikkeamat**: valitun junan pysähdyksittäiset aikataulupoikkeamat molempiin suuntiin. Värin rinnalla aina numeerinen minuuttiluku ja ennusteen/toteuman erottelu.
6. **Liikennevirta**: kaupallisten saapumisten ja lähtöjen määrä valitussa liikennepaikassa tai rataosan liikennepaikoissa. Yksikkö on pysähdystapahtuma, ei yksilöllinen juna tai raidevaraus.

Seuraavia lisätutkimuksia ovat **kahden junan päällekkäinen poikkeamavertailu** ja **valittavien rataosien tarkat ratakilometrit**. Näille tarvitaan omat tiedonlaatu- ja käyttäjätestit.

## Käyttöliittymän laatukriteerit

- Valittu juna näkyy samana kaikissa näkymissä; vaihtaminen on ennakoitavaa eikä hävitä tutkimuskontekstia.
- Jokainen aikaleima esitetään Suomen aikavyöhykkeellä, ja tallenne erotetaan reaaliaikaisesta aineistosta tekstillä, ei vain värillä.
- Ennuste, toteuma ja aikataulu eivät sekoitu. Tuntemattomuus ilmaistaan sanallisesti; puuttuva arvo ei muutu nollaksi.
- Tärkein toiminto on aina havaittavissa. Tiheä tieto on ryhmitelty; zoomaus, taulukot ja painikkeet ovat käytettävissä näppäimistöllä.
- Testataan ainakin 1366×768, 1920×1080 ja 2560×1440 sekä 125–200 % selainzoomaus. Tarkistetaan WCAG 2.2 AA:n kannalta olennaiset kohdat myös käsin.
- Typografia, kontrastit, kuvakkeet ja mitoitus muodostavat yhden yhtenäisen suunnittelujärjestelmän; animaatioita käytetään vain tilamuutosten ymmärtämisen tukena.

## Esittelytilanne Fintrafficia varten

1. Valitse **Tallenne**, jotta sama tilanne toistuu luotettavasti ilman riippuvuutta verkosta.
2. Vaihda **Tilanne**-sivulla **Kartta → Rataosat → Linjakaavio → Junan kulku**. Valitse sama juna ja näytä, että tiedot ja korostus seuraavat mukana. Kerro, mikä tieto on todellinen GPS-havainto ja mikä aikataulusta laskettu.
3. Avaa **Analyysi**, valitse havaittu viivästynyt juna ja tarkista seuraava pysähdys, toteumat sekä mahdollisesti liittyvät tiedotteet.
4. Avaa **Aikataulut**; vaihda kaikki kuusi näkymää läpi. Avaa **Näyttöasetukset**, rajaa aikataulun viivojen määrä ja vaihda viivekartan mittaria. Näytä sama juna valittuna eri näkymissä.
5. Palaa **Analyysi**-sivulle, siirry tallenteessa eteenpäin ja tarkastele muuttuvaa havaintohistoriaa.
6. Vie historian JSON. Kerro samalla selvästi, mitä lähde on vahvistanut ja mitä ei voi tästä aineistosta päätellä.

Onnistumisen mittari ei ole pelkkä näyttävä demo. Se on luotettava, toistettava työnkulku, joka auttaa ammattilaista ymmärtämään aineistoa nopeammin ilman perusteettomia väitteitä rautatieliikenteen turvallisuustilasta.
