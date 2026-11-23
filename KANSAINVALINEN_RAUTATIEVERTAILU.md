# Kansainvälinen vertailu — RAIDE 1.4

Tutkittu 22.11.2026. Tavoite: selvittää, millaisia havainto-, suunnittelu- ja häiriönhallintanäkymiä rautatieliikenteen ammattilaiset hyödyntävät eri maissa. Lähteet ovat rataverkon omistajien, liikenteenharjoittajien, viranomaisten ja järjestelmätoimittajien julkista aineistoa. Julkinen lähde **ei** tarkoita pääsyä tuotteiden sisäisiin käyttöliittymiin eikä todista tarkkaa yksittäisen näytön asettelua.

## Päälöydökset

| Maa / toimija                               | Todennettu toimintamalli                                                                                                                                                                                                                           | Suunnitteluhavainto RAIDEen                                                                                        | Mitä ei voi toteuttaa pelkällä avoimella Suomen junadatalla                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Japani — JR East ATOS**                   | Korkeatiheyksisen liikenteen aikataulu-, muutoksenhallinta-, automaattinen reitinohjaus- ja matkustajainformaatiokokonaisuus. Tutkimuksessa painottuu häiriöiden jälkeinen junavälien ja kaluston/henkilöstön palautuminen.                        | Nosta valitun junan tulevat aikataulupisteet, ennuste- ja toteumaerot sekä palvelun eteneminen kartan rinnalle.    | Vaihteiden, opastimien ja todellisten junavälien ohjaus tai ehdotettu liikenteen palautussuunnitelma ilman tarkkoja operatiivisia syötteitä. |
| **Yhdistynyt kuningaskunta — Network Rail** | Etelä-Walesin ARAMIS-päätöksentukijärjestelmä nostaa mahdollisia kulkuhäiriöitä ja tukee reaaliaikaista uudelleensuunnittelua. Julkisen kuvauksen mukaan Welsh ODST oli irrotettu opastimien ohjauksesta.                                          | Selkeä poikkeamakooste ja siitä tarkennettava rataosakohtainen näkymä; erottele seuranta ja liikenteen ohjaaminen. | Konfliktin todentaminen, junajärjestyksen muuttaminen tai signaloinnin toimenpiteet.                                                         |
| **Yhdysvallat — Union Pacific**             | Harrimanin keskus käyttää CADx-järjestelmää, jonka avulla työntekijät näkevät ohjattavia rataosia ja opastin-/vaihdetiloja. UP Vision esitetään koko verkon junaseurantatyökaluna.                                                                 | Koko verkon, rataosan ja yhden junan porautumistasot; yhteinen junan valinta.                                      | CADx:n liikennöintiluvat, vaihteiden asetus, opastintila tai liikennerajoitukset.                                                            |
| **Yhdysvallat — Amtrak**                    | Kansallisen operaatiokeskuksen ja alueellisen junien ohjauksen roolit, katkoihin reagointi sekä miehistö- ja kalustotilanne yhdistetään operatiiviseksi työksi.                                                                                    | Tapahtuman ja junan tilanteen yksityiskohtainen, jatkuva tutkimuspolku.                                            | Todellinen henkilö- tai kalustoresurssien ohjaus; vaatisi sisäiset tietolähteet.                                                             |
| **Australia — ARTC**                        | Verkonohjaajat hallitsevat junaliikennettä rataosilla. Train Control Graph -kaaviot sisältävät muun muassa liikenne-, kunnossapito- ja valtuustietoja. TMACS-elektroniset liikennöintiluvat ovat erillinen, turvallisuuskriittinen ohjaustoiminto. | Asemasta asemaan etenevä kaavionäkymä, jossa aikataulupisteet ovat luettavissa ilman maantieteellistä mittakaavaa. | Ratavaraukset, työn suojaus, kulku- ja työluvat, todellinen rataraiteisto.                                                                   |
| **Saksa — Deutsche Bahn**                   | Julkisen vuosikertomuksen mukaan tekoälyavusteista liikenteenohjauksen päätöksentekoa on pilotoitu, ja sen tarkoitus on simuloida tilanteen kehittymistä ja havaita mahdollisia ristiriitoja.                                                      | Näytä erikseen toteutunut, ennakoitu ja täysin simuloitu tieto.                                                    | Ennustava konfliktien ratkaisu tai simuloinnin luotettavuus ilman infrastruktuuri-, aikataulu- ja liikennöintitietoja.                       |
| **Alankomaat — ProRail**                    | Verkkoa hallitaan paikallisista liikenteenohjauspisteistä ja kansallisen Operationeel Controle Centrum Rail -koordinaation avulla. Paikallinen häiriö voi heijastua valtakunnallisesti.                                                            | Rataosien kokonaistilanne, josta voi porautua palveluihin; koko verkon ja paikallisen työn eri tasot.              | Häiriön syy-seurausketjun varmistus ilman vahvistettuja tapahtumia ja infrastruktuuritietoja.                                                |
| **Ranska — SNCF Réseau**                    | Liikenteenhallintakeskukset seuraavat sektoreittain kulkua ja koordinoivat häiriöitä. Vuoden 2026 verkkoasiakirjat kuvaavat reaaliaikaista junan kulun, viiveiden ja häiriöiden vaikutusten seurantaa.                                             | Junan valinta → tapahtumatiedot → reitti → mahdolliset vaikutusalueet.                                             | Vahvistettu häiriön vaikutus tiettyyn junaan vain asemaosuman perusteella.                                                                   |

## Näkymien suunnitteluperiaate

**Kartta ei ole sama asia kuin ratakaavio.** Julkinen GPS voi osoittaa junan maantieteellisen pisteen, mutta se ei määritä vaihteen asentoa, kulkutietä, raidevarausta, opastimen näyttöä tai ajolupaa. Edes rataverkon geometriasta ei voida päätellä kaikkia näitä tiloja.

RAIDEssa viisi **Junaliikenne**-valintaa ovat:

1. **Kartta** — Suomen kartta tuoreista junien GPS-havainnoista, klusterit ja reittiyhteydet. Tarkoitus on maantieteellinen yleiskuva.
2. **Linjakaavio** — rataosalle valitut asemat pysyvässä järjestyksessä ja **kunkin junan seuraava julkaistu aikataulupiste**. Aikataulusta/toteumasta johdettu, ei GPS:ään perustuva sijainti tai fyysinen raidekaavio. Junakortti avaa saman junan kaikkialla sovelluksessa.
3. **Ratakaavio — periaatekuva** — julkaisun mukaisten liikennepaikkojen järjestys, suunnittaiset havainnollistavat esityskaistat, tulevien asematapahtumien junamerkit ja valittavan junan aikataulutiedot. Laajennettava työtila. Haarautumat eivät ole todellisia vaihteita tai raiteita; merkki ei ole junan fyysinen sijainti.
4. **Rataosat** — kuuden esimerkkirataosan kortit, joissa junien määrä, yli viiden minuutin viiveet ja tuoreet GPS-havainnot. Kortista aukeaa kyseisen rataosan linjakaavio. Junat saattavat kuulua useaan rataosaan.
5. **Junan kulku** — valitun junan asemakohtainen eteneminen, aikataulu, ennuste tai toteuma, poikkeama ja peruutukset. Käyttäjä voi lisätä ohituspaikat ja avata graafisen aikataulun.

Valittu näkymä ja rataosa säilyvät selaimen paikallisissa asetuksissa, jos tallennus on sallittu. Kaikki näkymät toimivat sekä Digitrafficin reaaliaikaisella aineistolla että sovelluksen todelliseen havaintoaineistoon perustuvalla tallenteella.

Graafisen aikataulun **kuusi erillistä esitysmuotoa** ovat edelleen käytettävissä (Aika–paikka, Viivekartta, Junien aikajanat, Asemamatriisi, Poikkeamat ja Liikennevirta). Liikenteen tilannekuva ja graafinen aikataulu eivät kilpaile; käyttäjä valitsee työtehtävään sopivan tason.

**Tietolaatukorjaukset v1.4:** viivekartan 15 minuutin ruudut alkavat kellon varttitunneilta; aikataulun varassa oleva tapahtuma ei ole vahvistettu nollaviive; peruutetut asematapahtumat jätetään viiveluvuista pois. Live-aikataulut pysyvät käytössä GPS-palvelun häiriössä; GPS:n tilasta ilmoitetaan erikseen. Aikataululähteen päivitysaikaa ei enää muokata GPS-pollauksen yhteydessä. Reitin seuraavan pisteen aikaleimaa ei päätellä edellisen pisteen viiveestä.

## Ammattitason seuraavat tutkimus- ja laatukriteerit

1. **Todellisen operatiivisen käyttäjän haastattelu:** liikenteenohjaajan ja matkustajainformaation asiantuntijan erilliset työnkulut. Mitä on päätettävä 10 sekunnissa? Mitkä tiedot luokitellaan vain havainnollistaviksi?
2. **Tiedon tuoreus riveittäin:** eri rautatie-API:en päivitysvälit, lähteen aikaleima ja sijainnin/ennusteen vanheneminen jokaisessa näkymässä.
3. **Syy–seuraus vain todennettuna:** korrelaatio kahden junan viiveissä ei ole vahvistettu konflikti. Merkitse simuloidut skenaariot erillisinä.
4. **Infrastruktuurin virallinen mallinnus:** tutki Fintrafficin Infra-API:n yhteensopivuus liikennepaikkoihin ja käyttöehdot. Kulkutiet, raidevaraukset ja opastintilat vaativat erilliset oikeudet ja tiedot.
5. **Ohjaamotyöpöydän käytettävyys:** aikarajoitettu tehtävätesti, näytön tarkennus, näppäimistöpolku, 1366 px -piennäyttö ja suuren tietomassan suorituskyky.
6. **Selitettävä data:** jokaisesta merkittävästä näytettävästä havainnosta siirtyminen alkuperäiseen junaan, aikaleimaan, suunnitelmaan ja tietolähteeseen.

## Suorat lähteet

### Japani

- JR East, [ATOS development and functions](https://www.jreast.co.jp/en/company/business_strategy/business/transportation/construction/base/).
- JR East R&D, [Support for quick return to schedule after disruptions](https://www.jreast.co.jp/en/e/development/theme/trust/trust01.html).

### Yhdistynyt kuningaskunta

- Network Rail, [Traffic management technology reduces delays in Wales](https://www.networkrail.co.uk/stories/traffic-management-technology-reduces-delays-in-wales/).
- Network Rail, [Proven technology — Traffic Management](https://www.networkrail.co.uk/our-work/railway/digital-railway/proven-technology/).

### Yhdysvallat

- Union Pacific, [How does train dispatching work?](https://www.up.com/news/service/tr030921-how-does-train-dispatching-work).
- Union Pacific, [Technology helps keep Union Pacific moving](https://www.up.com/communities/rail-safety/innovation).
- Amtrak, [Unified Operations Center](https://media.amtrak.com/2024/04/amtrak-selects-construction-contractor-for-wilmington-unified-operations-center/).

### Australia

- ARTC, [Network control](https://www.artc.com.au/work/contractors/rswc/network-control/).
- ARTC, [Engineering guideline EGG-20-01, Train Control Graph](https://extranet.artc.com.au/docs/eng/all/guidelines/EGG-20-01.pdf).
- ARTC, [TMACS electronic authorities, September 2026](https://www.artc.com.au/2026/09/29/digital-upgrade-making-rail-safer-and-simpler-for-freight-customers-and-passenger-trains/).

### Muu Eurooppa

- Deutsche Bahn, [2024 report — AI dispatch pilot](https://ibir.deutschebahn.com/2024/en/combined-management-report/product-quality-and-digitalization/digitalization-and-technology/operations-and-production/).
- ProRail, [Coordination of train traffic](https://www.prorail.nl/over-ons/wat-doet-prorail/coordinatie-treinverkeer).
- SNCF Réseau, [Safe railway traffic and operational centers](https://www.sncf-reseau.com/fr/securite-ferroviaire/faire-circuler-les-trains-en-toute-securite).

### Suomi

- Digitraffic, [Railway traffic APIs](https://www.digitraffic.fi/rautatieliikenne/) — aikataulu, toteuma, ennuste, puutteelliset sijainnit ja turvallisuuskäytön rajat.
- Digitraffic, [English railway traffic API overview](https://www.digitraffic.fi/en/railway-traffic/).

Tämä on julkisten lähteiden **suunnittelututkimus**. RAIDE ei käytä tai jäljittele muiden toimijoiden sisäisiä ohjelmistoja, vaan soveltaa avoimesti kuvattuja operatiivisen käyttöliittymäsuunnittelun periaatteita omaan tietomalliinsa.
