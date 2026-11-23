import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { icon } from './icons';
import {
  date,
  delay,
  endpoints,
  key,
  label,
  nextStop,
  noticeText,
  time,
  visibleTrains,
  type Location,
  type Notice,
  type Station,
  type Train,
} from './domain';
import { matchingNotices, rowDeviation, type Observation } from './investigation-model';

/** Read-only decision support: never represents signalling state or movement authority. */
export class Investigation extends LitElement {
  createRenderRoot() {
    return this;
  }
  @property({ attribute: false }) trains: Train[] = [];
  @property({ attribute: false }) locations: Location[] = [];
  @property({ attribute: false }) stations = new Map<string, Station>();
  @property({ attribute: false }) notices: Notice[] = [];
  @property({ attribute: false }) observations: Observation[] = [];
  @property() selected = '';
  @property() mode: 'live' | 'recorded' = 'recorded';
  @property() updatedAt = '';
  @property({ type: Number }) now = Date.now();
  @state() private historyScope: 'selected' | 'all' = 'selected';
  @state() private historyLimit = 25;
  @state() private showAllQueue = false;

  private emit(name: string, detail?: string) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private name(code: string) {
    return this.stations.get(code)?.stationName.replace(/ asema$/, '') ?? code;
  }
  private exportHistory(items: Observation[]) {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            lahde: 'Fintraffic / Digitraffic, CC BY 4.0',
            huomautus:
              'Havaitsemisajat ovat RAIDE-sovelluksen otosaikoja, eivät muutosten tarkkoja tapahtumahetkiä.',
            tila: this.mode === 'recorded' ? 'Tallenne' : 'Selainistunnon havainnot',
            havainnot: items,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `raide-havainnot-${this.selected.replace('/', '-') || 'kaikki'}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  render() {
    const active = visibleTrains(this.trains, this.locations, this.now);
    const queue = active
      .filter((t) => !t.cancelled && (delay(t, this.now) ?? 0) > 0)
      .sort((a, b) => (delay(b, this.now) ?? 0) - (delay(a, this.now) ?? 0));
    const selectedTrain = this.trains.find((t) => key(t) === this.selected);
    const relevant = selectedTrain ? matchingNotices(selectedTrain, this.notices, this.now) : [];
    const shownEvents = this.observations.filter(
      (o) => this.historyScope === 'all' || o.trainKey === this.selected,
    );
    const [origin, destination] = selectedTrain ? endpoints(selectedTrain) : ['', ''];
    const next = selectedTrain ? nextStop(selectedTrain, this.now) : undefined;
    const stops =
      selectedTrain?.timeTableRows
        .filter(
          (r) =>
            r.commercialStop &&
            (r.type === 'ARRIVAL' || r === selectedTrain.timeTableRows[0]) &&
            (Date.parse(r.actualTime ?? r.liveEstimateTime ?? r.scheduledTime) >=
              this.now - 40 * 60000 ||
              !r.actualTime),
        )
        .slice(0, 9) ?? [];
    const sourceText =
      this.mode === 'recorded'
        ? 'Tallennettu havaintoaineisto'
        : 'Istunnon aikana vastaanotettu aineisto';

    return html`<div class="investigation-workspace">
      <div class="investigation-banner">
        <div>
          <span class="eyebrow">TILANNEANALYYSI / RAIDE</span>
          <h2>Havaitse. Tutki. Vertaile.</h2>
          <p>
            Yhdistetty tarkastelu avoimesta junaliikenneaineistosta — ei liikenteenohjauksen
            päätöksentekoa tai ajolupatietoja.
          </p>
        </div>
        <div class="investigation-source">
          <span class="source-pip"></span><strong>${sourceText}</strong>
          <small
            >Aineiston aikaleima
            ${this.updatedAt ? `${date(this.updatedAt)} ${time(this.updatedAt)}` : 'ei saatavilla'}</small
          >
        </div>
      </div>

      <div class="analysis-kpis" aria-label="Tilanneanalyysin yhteenveto">
        <div class="analysis-kpi">
          <span>SEURANNASSA</span><strong>${active.length}</strong
          ><small>junaa tarkasteluaikana</small>
        </div>
        <div class="analysis-kpi emphasis">
          <span>HAVAITTU VIIVE</span><strong>${queue.length}</strong
          ><small>juna, jolla laskettavissa oleva viive</small>
        </div>
        <div class="analysis-kpi">
          <span>HAVAINTOHISTORIA</span><strong>${this.observations.length}</strong
          ><small>tietomuutosta aineistossa</small>
        </div>
        <div class="analysis-kpi">
          <span>VALITUN JUNAN TIEDOTTEET</span><strong>${relevant.length}</strong
          ><small>juna- tai liikennepaikkayhteys</small>
        </div>
      </div>

      <div class="investigation-grid">
        <section class="panel queue-panel" aria-label="Myöhässä olevien junien luettelo">
          <div class="panel-heading">
            <h2>
              ${icon('alert', 18)} Havaitut viiveet <span class="count">${queue.length}</span>
            </h2>
          </div>
          <p class="analysis-panel-intro">
            Valitse juna avataksesi sen tilannekuvan. Viive perustuu saatavilla olevaan ennusteeseen
            tai toteumaan.
          </p>
          <div class="queue-items">
            ${queue.slice(0, this.showAllQueue ? 80 : 15).map((t, index) => {
              const [from, to] = endpoints(t);
              const chosen = key(t) === this.selected;
              return html`<button
                class="queue-item ${chosen ? 'chosen' : ''}"
                aria-pressed=${chosen}
                @click=${() => this.emit('train-select', key(t))}
              >
                <span class="queue-order">${String(index + 1).padStart(2, '0')}</span>
                <span class="queue-train"
                  ><strong>${label(t)}</strong
                  ><small>${this.name(from)} – ${this.name(to)}</small></span
                >
                <span class="queue-delay">+${delay(t, this.now)} <small>min</small></span>
              </button>`;
            })}
            ${!queue.length ? html`<div class="analysis-empty">Ei laskettavissa olevia viiveitä tällä hetkellä. Tämä ei tarkoita, ettei häiriöitä olisi.</div>` : nothing}
          </div>
          ${queue.length > 15 ? html`<button class="queue-more" @click=${() => (this.showAllQueue = !this.showAllQueue)}>${this.showAllQueue ? 'Näytä vähemmän' : `Näytä lisää (${queue.length - 15})`}</button>` : nothing}
        </section>

        <section class="panel case-panel" aria-label="Valitun junan tilanneanalyysi">
          ${
            selectedTrain
              ? html`
                  <div class="case-heading">
                    <div>
                      <span class="eyebrow">VALITTU JUNA · ${selectedTrain.departureDate}</span>
                      <h2>
                        ${label(selectedTrain)}
                        <span>${this.name(origin)} – ${this.name(destination)}</span>
                      </h2>
                    </div>
                    <raide-delay-badge
                      .value=${delay(selectedTrain, this.now)}
                      .cancelled=${selectedTrain.cancelled}
                    ></raide-delay-badge>
                  </div>
                  <div class="case-status-row">
                    <div>
                      <span>SEURAAVA KAUPALLINEN PYSÄHDYS</span
                      ><strong>${next ? this.name(next.stationShortCode) : 'Ei saatavilla'}</strong
                      ><small
                        >${next ? `Ennuste ${time(next.liveEstimateTime ?? next.scheduledTime)}` : 'Ei tulevaa pysähdysennustetta'}</small
                      >
                    </div>
                    <div>
                      <span>JUNAN TILA</span
                      ><strong
                        >${selectedTrain.cancelled ? 'Peruttu' : selectedTrain.runningCurrently ? 'Liikenteessä' : 'Ei liikennetilavahvistusta'}</strong
                      ><small>Digitrafficin ilmoittama tila</small>
                    </div>
                  </div>
                  <div class="case-subheading">
                    <h3>Pysähdysten tilanne</h3>
                    <button @click=${() => this.emit('open-timetable')}>
                      Avaa graafinen aikataulu ${icon('chevron', 14)}
                    </button>
                  </div>
                  <div class="case-stops scroll-area">
                    <table>
                      <thead>
                        <tr>
                          <th>Liikennepaikka</th>
                          <th>Aikataulu</th>
                          <th>Ennuste / toteuma</th>
                          <th>Poikkeama</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${stops.map((r) => {
                          const delta = rowDeviation(r);
                          return html`<tr>
                            <td>
                              <strong>${this.name(r.stationShortCode)}</strong
                              ><small
                                >${r.actualTime ? 'Toteuma' : r.liveEstimateTime ? 'Ennuste' : 'Vain aikataulu'}</small
                              >
                            </td>
                            <td>${time(r.scheduledTime)}</td>
                            <td>
                              ${r.actualTime || r.liveEstimateTime ? time(r.actualTime ?? r.liveEstimateTime) : '—'}
                            </td>
                            <td>
                              <span class="case-delta ${delta !== null && delta > 0 ? 'late' : ''}"
                                >${r.cancelled ? 'Peruttu' : delta === null ? '—' : delta > 0 ? `+${delta} min` : delta < 0 ? `${delta} min` : '0 min'}</span
                              >
                            </td>
                          </tr>`;
                        })}
                      </tbody>
                    </table>
                    ${!stops.length ? html`<p class="analysis-empty">Ei ajankohtaisia kaupallisia pysähdyksiä. Tutki koko reittiä aikataulunäkymässä.</p>` : nothing}
                  </div>
                  <div class="case-notices">
                    <div class="case-subheading">
                      <h3>Liittyvät matkustajatiedotteet</h3>
                      <span>${relevant.length} havaintoa</span>
                    </div>
                    ${relevant.slice(0, 4).map(
                      (n) =>
                        html`<button
                          class="case-notice"
                          @click=${() => this.emit('open-notice', n.id)}
                        >
                          ${icon('info', 15)}<span
                            ><strong
                              >${typeof n.trainNumber === 'number' ? `Juna ${n.trainNumber}` : 'Reitin liikennepaikka'}</strong
                            >
                            ${noticeText(n)}<small
                              >Voimassa ${time(n.startValidity)}–${time(n.endValidity)}</small
                            ></span
                          >${icon('chevron', 13)}
                        </button>`,
                    )}
                    ${!relevant.length ? html`<p class="case-notice-empty">Ei suoraan tähän junaan tai reitin liikennepaikkoihin yhdistettyjä voimassa olevia tiedotteita. Tiedotteiden puuttuminen ei ole häiriöttömyystakuu.</p>` : nothing}
                  </div>
                `
              : html`<div class="analysis-empty">
                  Valitse juna vasemmalta tai junaluettelosta aloittaaksesi analyysin.
                </div>`
          }
        </section>
      </div>

      <section class="panel observation-panel" aria-label="Tietomuutosten havaintohistoria">
        <div class="panel-heading observation-heading">
          <div>
            <span class="eyebrow">HAVAINTOJEN JÄLJITETTÄVYYS</span>
            <h2>
              ${icon('clock', 18)} Tietomuutosten aikajana
              <span class="count">${shownEvents.length}</span>
            </h2>
          </div>
          <div class="observation-actions">
            <div class="segmented" role="group" aria-label="Havaintohistorian rajaus">
              <button
                class=${this.historyScope === 'selected' ? 'active' : ''}
                @click=${() => {
                  this.historyScope = 'selected';
                  this.historyLimit = 25;
                }}
              >
                Valittu juna
              </button>
              <button
                class=${this.historyScope === 'all' ? 'active' : ''}
                @click=${() => {
                  this.historyScope = 'all';
                  this.historyLimit = 25;
                }}
              >
                Kaikki junat
              </button>
            </div>
            <button class="button secondary" @click=${() => this.exportHistory(shownEvents)}>
              ${icon('download', 14)} Vie JSON
            </button>
          </div>
        </div>
        <p class="analysis-panel-intro">
          ${this.mode === 'recorded' ? 'Tapahtumat on johdettu tallenteen peräkkäisistä havaintokehyksistä.' : 'Tässä selainistunnossa havaittuja lähdeaineiston muutoksia; historia ei ole palvelimen tapahtumaloki.'}
          Aikaleima kertoo, milloin muutos havaittiin — ei sen tarkkaa syntyhetkeä.
        </p>
        <div class="observation-list">
          ${shownEvents.slice(0, this.historyLimit).map(
            (event) =>
              html`<div class="observation-row">
                <span class="observation-time"
                  >${time(event.observedAt)}<small>${date(event.observedAt)}</small></span
                >
                <span class="observation-kind ${event.kind}"
                  >${event.kind === 'actual' ? icon('check', 16) : event.kind === 'cancelled' ? icon('alert', 16) : event.kind === 'forecast' ? icon('chart', 16) : icon('layers', 16)}</span
                >
                <div>
                  <strong>${event.title}</strong>
                  <p>${event.description}</p>
                </div>
                <button
                  class="observation-train"
                  @click=${() => this.emit('train-select', event.trainKey)}
                >
                  ${event.trainKey.replace('/', ' / ')} ${icon('chevron', 13)}
                </button>
              </div>`,
          )}
          ${!shownEvents.length ? html`<div class="analysis-empty">${this.mode === 'live' ? 'Ei vielä havaittuja muutoksia valitulla rajauksella. Seuranta alkaa sivun avaamisesta.' : 'Tallenteesta ei löytynyt muutoksia valitulle junalle tähän toistohetkeen mennessä.'}</div>` : nothing}
        </div>
        ${shownEvents.length > this.historyLimit ? html`<button class="queue-more" @click=${() => (this.historyLimit += 50)}>Näytä lisää havaintoja (${shownEvents.length - this.historyLimit})</button>` : nothing}
      </section>
    </div>`;
  }
}
customElements.define('raide-investigation', Investigation);
