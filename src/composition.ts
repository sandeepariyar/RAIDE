import { LitElement, html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { icon } from './icons';
import { type Station, type Train, key } from './domain';
export interface Composition {
  trainNumber: number;
  departureDate: string;
  journeySections: {
    beginTimeTableRow: { stationShortCode: string; scheduledTime: string };
    endTimeTableRow: { stationShortCode: string; scheduledTime: string };
    maximumSpeed: number;
    totalLength: number;
    locomotives: { location: number; locomotiveType: string }[];
    wagons: { location: number; wagonType: string; salesNumber?: number; length: number }[];
  }[];
}
export class TrainComposition extends LitElement {
  createRenderRoot() {
    return this;
  }
  @property({ attribute: false }) data: Composition | undefined;
  @property({ attribute: false }) stations = new Map<string, Station>();
  @property() status = 'loading';
  @property() mode = 'live';
  @state() private section = 0;
  protected updated(changed: Map<string, unknown>) {
    if (changed.has('data')) this.section = 0;
  }
  render() {
    if (this.status === 'loading')
      return html`<div class="composition-empty">Haetaan kokoonpanotietoja…</div>`;
    if (this.status === 'error')
      return html`<div class="composition-empty">
        <p>Kokoonpanotietoja ei voitu hakea.</p>
        <button
          class="text-button"
          @click=${() => this.dispatchEvent(new CustomEvent('composition-request', { bubbles: true, composed: true }))}
        >
          Yritä uudelleen
        </button>
      </div>`;
    if (!this.data?.journeySections?.length)
      return html`<div class="composition-empty">
        Junalle ei ole saatavilla kokoonpanotietoja.
      </div>`;
    const sections = this.data.journeySections;
    const s = sections[this.section] ?? sections[0];
    const vehicles = [
      ...s.locomotives.map((l) => ({
        position: l.location,
        type: l.locomotiveType,
        number: '',
        loco: true,
      })),
      ...s.wagons.map((w) => ({
        position: w.location,
        type: w.wagonType,
        number: w.salesNumber ? String(w.salesNumber) : '',
        loco: false,
      })),
    ].sort((a, b) => a.position - b.position);
    return html`<div class="composition-content scroll-area">
      ${
        sections.length > 1
          ? html`<label class="sr-only" for="composition-section">Kokoonpanon osuus</label
              ><select
                id="composition-section"
                .value=${String(this.section)}
                @change=${(e: Event) => (this.section = Number((e.target as HTMLSelectElement).value))}
              >
                ${sections.map((section, i) => html`<option value=${String(i)}>${this.stations.get(section.beginTimeTableRow.stationShortCode)?.stationName ?? section.beginTimeTableRow.stationShortCode} – ${this.stations.get(section.endTimeTableRow.stationShortCode)?.stationName ?? section.endTimeTableRow.stationShortCode}</option>`)}
              </select>`
          : html`<p class="composition-route">
              ${this.stations.get(s.beginTimeTableRow.stationShortCode)?.stationName ?? s.beginTimeTableRow.stationShortCode}
              –
              ${this.stations.get(s.endTimeTableRow.stationShortCode)?.stationName ?? s.endTimeTableRow.stationShortCode}
            </p>`
      }
      <div class="vehicle-strip" aria-label="Kokoonpanon järjestys">
        ${vehicles.map((v) => html`<div class="vehicle ${v.loco ? 'locomotive' : ''}">${v.loco ? icon('train', 18) : html`<strong>${v.number || v.position}</strong>`}<span>${v.type}</span></div>`)}
      </div>
      <div class="composition-summary">
        <span>Pituus <strong>${s.totalLength} m</strong></span
        ><span>Suurin nopeus <strong>${s.maximumSpeed} km/h</strong></span>
      </div>
      <p class="composition-note">
        ${this.mode === 'recorded' ? 'Kokoonpano haetaan erikseen avoimesta rajapinnasta. Se ei kuulu sijaintitallenteeseen.' : 'Kokoonpanotiedot: Fintraffic / Digitraffic. Vaunujen järjestys voi muuttua matkan aikana.'}
      </p>
    </div>`;
  }
}
customElements.define('raide-composition', TrainComposition);
