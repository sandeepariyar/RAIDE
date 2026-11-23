import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { key, label, time, type Station, type Train } from './domain';
import { icon } from './icons';
import type { Observation, ObservationKind } from './investigation-model';
import {
  eventsForRadarBucket,
  observationDescription,
  radarViewData,
  type RadarKind,
  type RadarWindow,
} from './change-radar-model';
import './change-radar.css';

const kinds: { id: RadarKind; name: string }[] = [
  { id: 'all', name: 'Kaikki muutokset' },
  { id: 'forecast', name: 'Ennusteet' },
  { id: 'cancelled', name: 'Peruutusmerkinnät' },
  { id: 'actual', name: 'Toteumat' },
  { id: 'track', name: 'Raidenumerotiedot' },
];

/**
 * Muutostutka: changes observed *between* recorded snapshots, not event onset.
 * Never treats a missing observation as proof that the network is disruption-free.
 */
export class ChangeRadar extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) observations: Observation[] = [];
  @property({ attribute: false }) trains: Train[] = [];
  @property({ attribute: false }) stations = new Map<string, Station>();
  @property({ type: Number }) now = Date.now();
  @property() selected = '';
  @property() mode: 'live' | 'recorded' = 'recorded';
  @property({ type: Boolean }) expanded = false;

  @state() private minutes: RadarWindow = 15;
  @state() private kind: RadarKind = 'all';
  @state() private onlySelected = false;
  @state() private bucketIndex = -1;
  @state() private showAll = false;
  @state() private detailsOpen = true;

  private emit(name: string, detail?: string) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private stationName(code?: string) {
    if (!code) return '';
    return this.stations.get(code)?.stationName.replace(/ asema$/, '') ?? code;
  }

  private trainName(trainKey: string, known: Map<string, Train>) {
    const train = known.get(trainKey);
    return train ? label(train) : `Juna ${trainKey.split('/').at(-1) ?? '—'}`;
  }

  private changeWindow(next: RadarWindow) {
    this.minutes = next;
    this.bucketIndex = -1;
    this.showAll = false;
  }

  render() {
    const trainScope = this.onlySelected && this.selected ? this.selected : '';
    // Time bars and evidence feed must obey the same kind/selected-train filters.
    const { base, narrowed, buckets } = radarViewData(
      this.observations,
      this.now,
      this.minutes,
      trainScope,
      this.kind,
    );
    const selectedBucket = buckets[this.bucketIndex];
    const scopedEvents = selectedBucket
      ? eventsForRadarBucket(
          narrowed.items,
          selectedBucket,
          this.bucketIndex === buckets.length - 1,
        )
      : narrowed.items;
    const events = this.showAll ? scopedEvents : scopedEvents.slice(0, this.expanded ? 20 : 8);
    const trains = new Map(this.trains.map((train) => [key(train), train]));
    const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.count));
    const source =
      this.mode === 'recorded' ? 'TALLENNETUT OTOKSET' : 'TÄMÄN SELAINISTUNNON OTOKSET';
    // The selected train may have left the current live feed while its history remains valid.
    const noSelected = !this.selected;

    return html`<section
      class="change-radar ${this.expanded ? 'change-radar-expanded' : ''}"
      aria-label="Muutostutka"
    >
      <div class="change-radar-top">
        <div class="change-radar-title">
          <span class="change-radar-eyebrow">RAIDE / HAVAITTUJEN MUUTOSTEN TUTKA</span>
          <h2><span class="change-radar-title-icon">${icon('target', 23)}</span> Muutostutka</h2>
          <p>Mikä muuttui sen jälkeen, kun liikennetietoja viimeksi verrattiin?</p>
        </div>
        <div class="change-radar-source" aria-label="Havaintoaineiston lähde">
          <span class="change-radar-source-dot"></span>
          <div>
            <strong>${source}</strong
            ><small
              >${base.latest ? `Viimeisin muutoksen havainto klo ${time(base.latest)}` : 'Ei muutoksia sisältäviä otoksia tällä jaksolla'}</small
            >
          </div>
        </div>
      </div>

      <div class="change-radar-controls">
        <div class="change-radar-window" role="group" aria-label="Valitse havainnointijakso">
          <span>AIKAJAKSO</span>
          ${([5, 15, 60] as const).map(
            (value) =>
              html`<button
                aria-pressed=${this.minutes === value}
                class=${this.minutes === value ? 'selected' : ''}
                @click=${() => this.changeWindow(value)}
              >
                ${value} min
              </button>`,
          )}
        </div>
        <div class="change-radar-filter">
          <label for="radar-kind-${this.expanded ? 'full' : 'compact'}">MUUTOSTYYPPI</label>
          <select
            id="radar-kind-${this.expanded ? 'full' : 'compact'}"
            aria-label="Rajaa havaintojen tyyppi"
            .value=${this.kind}
            @change=${(e: Event) => {
              this.kind = (e.target as HTMLSelectElement).value as RadarKind;
              this.bucketIndex = -1;
            }}
          >
            ${kinds.map((option) => html`<option value=${option.id}>${option.name}</option>`)}
          </select>
        </div>
        <button
          class="change-radar-follow ${this.onlySelected ? 'selected' : ''}"
          ?disabled=${noSelected}
          aria-pressed=${this.onlySelected}
          @click=${() => {
            this.onlySelected = !this.onlySelected;
            this.bucketIndex = -1;
          }}
        >
          ${icon('pin', 15)}
          ${this.onlySelected && !noSelected ? `Seurataan ${this.trainName(this.selected, trains)}` : 'Rajaa valittuun junaan'}
        </button>
        <button
          class="change-radar-explainer"
          aria-expanded=${this.detailsOpen}
          aria-label="Näytä tai piilota tietojen tulkinta"
          @click=${() => (this.detailsOpen = !this.detailsOpen)}
        >
          ${icon('info', 17)} <span>Kuinka tulkitaan?</span>
        </button>
      </div>

      ${
        this.detailsOpen
          ? html`<div class="change-radar-evidence" role="note">
              ${icon('info', 15)}
              <span
                ><strong>Havaittu muutos ei ole vahvistettu häiriön alkuhetki.</strong> Aikaleima
                kertoo, milloin RAIDE vastaanotti myöhemmän otoksen ja havaitsi eron edelliseen.
                Ensimmäisestä otoksesta tai puuttuvasta tiedosta ei päätellä, ettei muutoksia olisi
                ollut.
                ${this.mode === 'live' ? 'Aiempi istuntohistoria ei ole käytettävissä.' : 'Tallenteen tiedot perustuvat mukana oleviin havainto-otoksiin.'}</span
              >
            </div>`
          : nothing
      }

      <div class="change-radar-stats" aria-label="Havaitut muutokset valitulla ajanjaksolla">
        <div class="change-radar-stat major">
          <small>HAVAITTUJA MUUTOKSIA</small><strong>${base.total}</strong
          ><span>${base.trains} eri junassa</span>
        </div>
        <button
          class="change-radar-stat ${this.kind === 'forecast' ? 'active' : ''}"
          @click=${() => {
            this.kind = this.kind === 'forecast' ? 'all' : 'forecast';
            this.bucketIndex = -1;
          }}
          aria-pressed=${this.kind === 'forecast'}
        >
          <small>ENNUSTEET</small><strong>${base.forecast}</strong><span>muutosta</span>
        </button>
        <button
          class="change-radar-stat alert ${this.kind === 'cancelled' ? 'active' : ''}"
          @click=${() => {
            this.kind = this.kind === 'cancelled' ? 'all' : 'cancelled';
            this.bucketIndex = -1;
          }}
          aria-pressed=${this.kind === 'cancelled'}
        >
          <small>PERUUTUSMERKINNÄT</small><strong>${base.cancelled}</strong><span>muutosta</span>
        </button>
        <button
          class="change-radar-stat ${this.kind === 'actual' ? 'active' : ''}"
          @click=${() => {
            this.kind = this.kind === 'actual' ? 'all' : 'actual';
            this.bucketIndex = -1;
          }}
          aria-pressed=${this.kind === 'actual'}
        >
          <small>TOTEUMAT</small><strong>${base.actual}</strong><span>uutta havaintoa</span>
        </button>
      </div>

      <div class="change-radar-body">
        <div class="change-radar-pulse">
          <div class="change-radar-section-heading">
            <div>
              <span class="change-radar-eyebrow">MUUTOSTEN RYTMI</span>
              <h3>Aikajana · ${this.minutes} minuuttia</h3>
            </div>
            <span
              >${narrowed.total ? `${narrowed.total} otosmuutosta rajauksessa` : 'Ei havaittuja muutoksia'}</span
            >
          </div>
          <div class="change-radar-bars" role="group" aria-label="Muutokset aikaruutuina">
            ${buckets.map((bucket, index) => {
              const intensity = bucket.count / maxBucket;
              return html`<button
                class="change-radar-bar ${this.bucketIndex === index ? 'chosen' : ''} ${bucket.count ? 'has-event' : 'is-empty'}"
                style=${`--radar-height:${Math.max(4, intensity * 100)}%;`}
                aria-label=${`${time(bucket.start)}–${time(bucket.end)}, ${bucket.count} muutosta. ${bucket.forecast} ennustetta, ${bucket.cancelled} peruutusmerkintää, ${bucket.actual} toteumaa, ${bucket.track} raidenumerotietoa.`}
                aria-pressed=${this.bucketIndex === index}
                title=${`${time(bucket.start)}–${time(bucket.end)} · ${bucket.count} muutosta`}
                @click=${() => {
                  this.bucketIndex = this.bucketIndex === index ? -1 : index;
                  this.showAll = false;
                }}
              >
                <span class="change-radar-bar-grid"></span>
                <span class="change-radar-bar-stack">
                  ${(['forecast', 'actual', 'cancelled', 'track'] as const).map((kind) => html`<i class=${kind} style=${`height:${bucket.count ? (bucket[kind] / bucket.count) * 100 : 0}%;`}></i>`)}
                </span>
              </button>`;
            })}
          </div>
          <div class="change-radar-time-axis">
            <span>${time(buckets[0]?.start)}</span><span>${time(this.now)}</span>
          </div>
          <div class="change-radar-pulse-note">
            <span><i class="forecast"></i> Ennustemuutokset</span>
            <span><i class="actual"></i> Toteumat</span>
            <span><i class="cancelled"></i> Peruutusmerkinnät</span>
            <span><i class="track"></i> Raidenumerotiedot: ${base.track}</span>
          </div>
        </div>
        <div class="change-radar-feed">
          <div class="change-radar-section-heading">
            <div>
              <span class="change-radar-eyebrow">MUUTOSLOKI / TODENNETTU ERO OTOKSISSA</span>
              <h3>
                ${selectedBucket ? `Aikaruutu ${time(selectedBucket.start)}–${time(selectedBucket.end)}` : 'Viimeisimmät havaitut muutokset'}
              </h3>
            </div>
            ${selectedBucket ? html`<button class="change-radar-clear" @click=${() => (this.bucketIndex = -1)}>Tyhjennä aikarajaus ${icon('close', 13)}</button>` : nothing}
          </div>
          <div class="change-radar-events">
            ${events.map(
              (observation) =>
                html`<button
                  class="change-radar-event ${observation.kind} ${observation.trainKey === this.selected ? 'is-selected' : ''}"
                  @click=${() => this.emit('train-select', observation.trainKey)}
                  aria-label=${`${this.trainName(observation.trainKey, trains)}; ${observationDescription(observation.kind)}; havaittu viimeistään ${time(observation.observedAt)}; ${observation.description}. Valitse juna.`}
                >
                  <span class="change-radar-event-marker"></span>
                  <span class="change-radar-event-detail">
                    <span class="change-radar-event-first"
                      ><strong>${this.trainName(observation.trainKey, trains)}</strong
                      ><em>${observationDescription(observation.kind)}</em></span
                    >
                    <span class="change-radar-event-title"
                      >${observation.title}${observation.stationCode ? html` · ${this.stationName(observation.stationCode)}` : nothing}</span
                    >
                    <span class="change-radar-event-description">${observation.description}</span>
                  </span>
                  <span class="change-radar-event-time"
                    ><time>${time(observation.observedAt)}</time
                    ><small>Otos</small>${icon('chevron', 13)}</span
                  >
                </button>`,
            )}
            ${
              !events.length
                ? html`<div class="change-radar-empty">
                    ${icon('check', 23)}<strong>Ei havaittuja muutoksia tässä rajauksessa.</strong>
                    <p>
                      Tilanne voi silti muuttua havaintojen välillä tai muissa tietolähteissä. Tämä
                      ei ole vahvistus häiriöttömyydestä.
                    </p>
                  </div>`
                : nothing
            }
          </div>
          ${scopedEvents.length > (this.expanded ? 20 : 8) ? html`<button class="change-radar-more" @click=${() => (this.showAll = !this.showAll)}>${this.showAll ? 'Näytä vähemmän' : `Näytä kaikki ${scopedEvents.length} muutosta`} ${icon('chevron', 14)}</button>` : nothing}
        </div>
      </div>
      <div class="change-radar-footer">
        <span
          >${icon('info', 14)} Aineisto: Fintraffic / Digitraffic, CC BY 4.0. Otosten välisiä eroja;
          ei liikenteenohjauskäskyjä tai ratavarauksia.</span
        >
        <button @click=${() => this.emit('open-investigation')}>
          Avaa tilanneanalyysi ${icon('external', 14)}
        </button>
      </div>
    </section>`;
  }
}

customElements.define('raide-change-radar', ChangeRadar);
