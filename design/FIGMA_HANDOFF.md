# RAIDE · Design system, takaisinmallinnus ja Figma-handoff

**Päivitetty:** 23.11.2026 · **Versio:** 1.8 · **Omistaja:** Sandeep Pariyar

**[Avaa muokattava Figma-tiedosto](https://www.figma.com/design/2iKCBR5lj1vpUUEPOmoDDt)**

> RAIDE on itsenäinen, julkista junaliikennetietoa käyttävä portfolio- ja analyysisovellus.
> Ei Fintrafficin palvelu, raidevarauksen näyttö tai liikenteenohjauksen turvalaite.
> Kuvitteellisia UI-tapauksia ei saa merkitä reaaliaikaisiksi havainnoiksi.

## 1. Takaisinmallinnuksen lähtökohdat

Suunnittelujärjestelmän todellinen lähde on **`design/tokens.json`**. Generaattori
`scripts/build-tokens.mjs` tuottaa siitä `src/tokens.css`-muuttujat. Tyylit ovat hajautuneet
`src/style.css`, `src/operations.css`, `src/living-network.css`, `src/command-shell.css`,
`src/hmi.css`, `src/schematic.css` ja näkymäkohtaisiin CSS-tiedostoihin.

Figmaan luotiin **14 primitiiviväriä, 14 semanttista värialiasmuuttujaa, 5 välimittaa ja 1
säde**. Muuttujien Web-syntaksi osoittaa tuotantotyylien `--color-*`, `--spacing-*` ja
`--radius-panel` -nimiin. Tiedoston tilaksi luotiin **Dark**, koska nykyinen sovellus on
tumma ja Figma Starter rajoittaa muuttujakokoelman yhteen tilaan. Muuttujia voi muokata
Figmassa; niiden arvoja ei vielä synkronoida automaattisesti takaisin JSON-lähteeseen.

### Tunnisteet ja merkitykset

| Lähdetoken | Käyttötarkoitus | Huomio |
| --- | --- | --- |
| `color/bg`, `color/surface`, `color/surface-2` | Sovelluksen tausta ja pintatasot | Esittää hierarkiaa, ei liikenteen tilaa |
| `color/text`, `color/muted` | Ensisijainen ja toissijainen teksti | Vaaleuskontrasti tarkistettava myös oikeassa käyttöliittymässä |
| `color/mint` | Positiivinen tila / aktiivinen valinta | Aina myös sana tai kuvake |
| `color/blue` | Tallenne ja havaintolähteen tunniste | Ei tarkoita fyysistä junasijaintia |
| `color/amber` | Varoitus, viive, epävarmuus | Ei saa tarkoittaa vahvistettua poikkeamaa, jos tiedossa vain ennuste |
| `color/border`, `color/border-strong` | Ryhmien rajat ja kohdistuksen erotus | Fokus ei saa jäädä vain värin varaan |
| `spacing/xs`…`xl` | 4, 8, 16, 24, 32 px | Jo käytössä CSS-muuttujina |
| `radius/panel` | 10 px | Käytä paneelien ja ohjainten lähtökohtana |

## 2. Figma-komponentit ja toteutuksen vastineet

Tiedostossa on **6 aidosti muokattavaa component set -kokonaisuutta, 22 varianttia**.
Niillä on nimettyjä varianttiakseleita, tekstin vaihdettavia ominaisuuksia ja
semanttisiin Figma-muuttujiin sidottuja värejä/säteitä. Nämä ovat ensimmäinen järjestelmäversio,
eivät väite siitä, että kaikki RAIDE-käyttöliittymän näkymät olisivat Figmassa.

| Figma | Variantit | Vastine tuotannossa | Jatkotyö |
| --- | --- | --- | --- |
| [ActionButton](https://www.figma.com/design/2iKCBR5lj1vpUUEPOmoDDt?node-id=2-2) | 2 sävyä × 2 tilaa | `<button class="button">`, `.secondary`, käyttötilat CSS:ssä | Yhtenäistä hover/focus/disabled tokenit |
| [DataStatus](https://www.figma.com/design/2iKCBR5lj1vpUUEPOmoDDt?node-id=2-11) | Live, Recorded, Stale, Limited | `raide-data-status` + näkymien oma lähdemerkintä | Lähdetekstin ja roolin yhtenäistys |
| [DelayBadge](https://www.figma.com/design/2iKCBR5lj1vpUUEPOmoDDt?node-id=2-24) | OnTime, Delayed, Unknown, Cancelled | `raide-delay-badge` | CSS:n ja Figma-palettien eroavaisuuksien tarkistus |
| [FilterChip](https://www.figma.com/design/2iKCBR5lj1vpUUEPOmoDDt?node-id=2-33) | Default, Selected, Disabled | `<button aria-pressed>` eri työtiloissa | Yhteinen ohjainkomponentti jatkossa |
| [SearchField](https://www.figma.com/design/2iKCBR5lj1vpUUEPOmoDDt?node-id=2-40) | Empty, Focused, Filled, Error | Sovelluksen tekstihaku | Virheviestin saavutettavuussäännöt |
| [SourceNotice](https://www.figma.com/design/2iKCBR5lj1vpUUEPOmoDDt?node-id=2-49) | Information, Warning, Success | Lähde-, tallenne- ja häiriövaroitukset | Käyttäjä- ja tiedonluottamustestaus |

Muut Lit-koodikomponentit, joille **ei vielä ole vastaavaa Figma-komponenttiperhettä**:
`raide-train-table`, `raide-map`, `raide-train-detail`, `raide-change-radar`,
`raide-train-progress`, `raide-living-network`, `raide-investigation`,
`raide-traffic-views`. Niiden tila- ja poikkeusmallit on testattu koodissa;
ne tulee edelleen mallintaa Figmaan ennen täydellisen kirjaston julistamista.

## 3. Esitysjärjestelmän periaatteet

1. **Lähde näkyy:** reaaliaikainen, tallenne, rajattu ja vanhentunut ovat eri tiloja.
2. **Todiste ennen päätelmää:** toteuma, ennuste, aikataulu ja puuttuva havainto ovat eri käsitteitä.
3. **Ei tekaistua fyysistä topologiaa:** kaavion runko saa piirtää vain aikatauluaineiston tukemia yhteyksiä.
4. **Valinta seuraa junaa:** valittu juna pysyy työtiloissa; käyttäjän manuaalinen rataosavalinta pysyy,
   ja poikkeava junan sijainti ilmoitetaan tekstinä.
5. **Kaksi tapaa ymmärtää tila:** väriä ei käytetä ainoana merkkinä. Teksti, tunnus, aikaleima
   ja lähteen tarkkuus kuvataan rinnalla.
6. **Suomenkielinen termi:** ratakaavio, raiteistokaavio, fyysinen raidevaraus,
   aikataulupiste ja GPS-havainto eivät ole keskenään vaihtokelpoisia.

## 4. Käyttäjäpolku Fintraffic-esittelyyn

1. Avaa [RAIDE](https://sandeepariyar.github.io/RAIDE/) ja tarkista yläpalkin lähdetila.
2. Valitse **Katso tallenteen esimerkkimuutokset**. Sovellus siirtyy merkittyyn tallenteeseen,
   vie aikaliukusäätimen viimeisimpään tallennettuun havaintoon ja avaa Muutostutkan.
3. Valitse havaittu muutos ja avaa junan eteneminen. Korosta ennusteen ja vahvistetun
   tapahtuman eroa.
4. Avaa Elävä reittiverkko, valitse Oulu–Rovaniemi–Kemijärvi ja katso Tervola-korjaus.
   Näytä, että kaavio on aikataululähtöinen eikä ratavaraus- tai asetinlaitenäkymä.
5. Avaa **Komponenttikirjasto**, sitten [Storybook](https://sandeepariyar.github.io/RAIDE/komponentit/)
   ja tämän dokumentin Figma-variantit. Kerro sama konsepti: havainto → tila → komponentti → testi.

Esittely on tarkoitettu **UX/frontend-osaamisen osoittamiseen**, ei liikenteenohjauksen
työnkulkusertifiointiin. Kaikkia käytettävyys- ja WCAG-vaatimuksia ei ole vielä varmennettu
käyttäjillä tai apuvälineillä.

## 5. Jäljellä olevat portit ja rajoitteet

| Taso | Tila | Päättävä toimenpide |
| --- | --- | --- |
| Figma Foundation + 6 varianttiperhettä | Valmis | Tarkista esikatselu ja nimeä lopulliset variantit yhdessä |
| Figma desktop/mobile -esimerkkinäkymät | **Avoin** | Starter-suunnitelman MCP-kutsukiintiö estää lisäämisen tässä kierroksessa |
| Figma Code Connect | **Estynyt** | Vaatii julkaistun komponenttikirjaston ja Organization/Enterprise-tason |
| Web Components -kattavuus Figmassa | **Osittainen** | Lisää kahdeksan isoa näkymäkomponenttia ja niiden tyhjä/virhe/lataus-variantit |
| Typografia Figma ↔ CSS | **Osittainen** | CSS:n IBM Plex Sans / Mono; Figma-taulun luonti käyttää Inter-fonttia |
| Testit | Vitest/build valmis, browser-ajo CI:ssä | Tarkista GitHub Actions ja selainraportti |
| Saavutettavuus | Osittainen | Näppäimistö + ruudunlukija + WCAG 2.2 AA + 390/768/1366/1920 px hyväksyntä |
| Rautatiedatan laajuus | Osittainen | Ratarajoitteet ja ratatyöt omiksi lähde- ja varmuusluokikseen vasta skeeman tarkistuksen jälkeen |

GitHub Actions ajaa Playwright-testit Ubuntu/Chromiumilla osana julkaisuputkea. Paikallisen
ajoympäristön Chromium-käynnistys on estynyt käyttöjärjestelmän socket-oikeuksilla;
testejä ei voi merkitä paikallisesti läpäistyiksi, vaikka kaikki yksikkötestit läpäisevät.

**Jakelu:** Figma-tiedosto voi vaatia erillisen katselu- tai editointioikeuden. Varmista
oikeus ennen kuin lähetät linkin arvioijalle. RAIDE-lähdekoodin tekijänoikeusilmoitus
säilyy: © 2026 Sandeep Pariyar, kaikki oikeudet pidätetään.
