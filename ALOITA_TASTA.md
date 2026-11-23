# RAIDE — Aloita tästä

## Windows: avaa valmis sovellus

1. Pura ZIP kokonaan omaan kansioon.
2. Asenna Node.js 22 tai uudempi, jos sitä ei vielä ole: https://nodejs.org/
3. Kaksoisnapsauta **START_RAIDE.cmd**.
4. Sovellus avautuu osoitteessa **http://127.0.0.1:4173**.

Valmiin sovelluksen avaaminen ei edellytä `npm install` -komentoa tai uudelleenrakennusta. Pidä palvelinikkuna auki käytön ajan. Sulje palvelin painamalla Ctrl+C.

Vaihtoehtoinen käynnistys Windowsissa, macOS:ssä ja Linuxissa:

```sh
node scripts/serve.mjs --open
```

Komponenttien Storybook-esimerkit: **http://127.0.0.1:4173/komponentit/index.html**.

Älä avaa `dist/index.html`-tiedostoa suoraan kaksoisnapsauttamalla: JavaScript-moduulit, Web Worker ja aineistopyynnöt edellyttävät HTTP-palvelinta.

## Lähdekoodin kehittäminen

```sh
npm ci
npm run dev
```

Testaus ja uusi tuotantoversio:

```sh
npm test
npm run build
```

## Tilanneanalyysin kokeilu

1. Avaa **Tilanne** ja vaihda **Junaliikenne**-näkymää: **Kartta**, **Linjakaavio**, **Ratakaavio**, **Rataosat** ja **Junan kulku**. Kokeile **Ratakaavio → Laajenna näkymä** ja valitse junamerkki; huomaa periaatekuvan tietolähdevaroitus.
2. Valitse **Rataosat**, avaa esimerkiksi Helsinki–Tampere–Oulu ja tarkista asemakohtainen seuraavaksi ennustettu tai aikataulun mukainen piste. Valitse junakortti: junan tiedot päivittyvät muuallakin sovelluksessa.
3. Avaa **Junan kulku**, katso saman junan pysähdykset ja lähdemerkinnät sekä kokeile **Näytä myös ohituspaikat**. Siirry **Avaa graafinen aikataulu**. Vaihda takaisin tilannekuvaan; valittu liikennenäkymä säilyy.

### Syvempi analyysipolku

1. Valitse **Tallenne**, jos reaaliaikainen rajapinta ei ole saatavilla tai haluat toistettavan testin.
2. Siirry kohtaan **Analyysi** ja valitse juna kohdasta **Havaitut viiveet**.
3. Tutki seuraavaa kaupallista pysähdystä, ennustetta, toteumaa ja mahdollisesti liittyviä matkustajatiedotteita.
4. Valitse **Avaa graafinen aikataulu**. Vaihda esitystapaa: **Aika–paikka**, **Viivekartta**, **Junien aikajanat**, **Asemamatriisi**, **Poikkeamat** tai **Liikennevirta**.
5. Avaa **Näyttöasetukset**. Valitse esimerkiksi 12 tai 24 samanaikaisesti näkyvää junaa, poikkeamakartan mittari tai liikennevirran aikajakso. Valinnat pysyvät selaimessa; **Palauta oletusasetukset** palauttaa selkeän lähtönäkymän.
6. Palaa **Analyysi**-näkymään. Siirrä tallenteen aikajanaa eteenpäin ja tarkastele **Tietomuutosten aikajanaa**. Vaihda rajaus **Kaikki junat** / **Valittu juna** ja kokeile **Vie JSON**.

Huomaa, että tämä on analyysityökalu, ei turvallisuuskriittinen liikenteenohjausjärjestelmä. Tarkemmat kehityskriteerit: `AMMATTITASON_SUUNNITELMA.md`.

## Paketin sisältö

- **src/**: koko Lit/TypeScript-lähdekoodi ja testit
- **dist/**: valmiiksi rakennettu sovellus ja Storybook
- **public/**: todellinen tallenne, pohjakartta, liikennepaikat ja kirjasimet lisensseineen
- **design/**: visuaaliset token-määritykset
- **.storybook/**: komponenttiesimerkkien asetukset
- **scripts/**: rakennus-, käynnistys- ja tallennustyökalut
- **README.md**: toiminnot, arkkitehtuuri, rajapinnat, lähteet ja käyttöehdot
- **VERIFICATION.md**: tehdyt tarkastukset
- **AMMATTITASON_SUUNNITELMA.md**: priorisoidut jatkokehitystehtävät ja laadun hyväksymiskriteerit
- **KANSAINVALINEN_RAUTATIEVERTAILU.md**: seitsemän maan ammattilaiskäytäntöjen vertailu ja lähteet
- **package.json / package-lock.json**: kehitysriippuvuudet ja täsmälliset versiot

Reaaliaikaiset tiedot tarvitsevat verkkoyhteyden. Tallenne sisältää 15 todellista havaintokehystä 22.11.2026 klo 14.12–14.21 Suomen ajassa, ja se sisältyy pakettiin. Paikallinen sovellus ei edellytä ChatGPT-kirjautumista.

Suunnittelu ja toteutus: **Sandeep Pariyar**.
