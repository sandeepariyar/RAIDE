import { html } from 'lit';
import type { Meta, StoryObj } from '@storybook/web-components';
import './investigation';
import './timetable';
import './components';
import './traffic-views';
import type { Train, Station } from './domain';
import type { Observation } from './investigation-model';

const station = (
  stationShortCode: string,
  stationName: string,
  latitude: number,
  longitude: number,
): Station => ({
  stationShortCode,
  stationName,
  latitude,
  longitude,
  passengerTraffic: true,
  countryCode: 'FI',
  type: 'STATION',
});
const stations = new Map(
  [
    station('HKI', 'Helsinki asema', 60.171, 24.941),
    station('TPE', 'Tampere asema', 61.499, 23.77),
    station('OL', 'Oulu asema', 65.013, 25.482),
  ].map((s) => [s.stationShortCode, s]),
);
const trains: Train[] = [
  {
    trainNumber: 23,
    departureDate: '2026-11-22',
    trainType: 'IC',
    trainCategory: 'Long-distance',
    runningCurrently: true,
    cancelled: false,
    timeTableRows: [
      {
        stationShortCode: 'HKI',
        type: 'DEPARTURE',
        commercialStop: true,
        scheduledTime: '2026-11-22T09:00:00Z',
        actualTime: '2026-11-22T09:03:00Z',
        cancelled: false,
      },
      {
        stationShortCode: 'TPE',
        type: 'ARRIVAL',
        commercialStop: true,
        scheduledTime: '2026-11-22T10:40:00Z',
        liveEstimateTime: '2026-11-22T10:52:00Z',
        cancelled: false,
      },
      {
        stationShortCode: 'OL',
        type: 'ARRIVAL',
        commercialStop: true,
        scheduledTime: '2026-11-22T14:10:00Z',
        liveEstimateTime: '2026-11-22T14:22:00Z',
        cancelled: false,
      },
    ],
  },
];
const observations: Observation[] = [
  {
    id: 'example',
    observedAt: '2026-11-22T10:20:00Z',
    trainKey: '2026-11-22/23',
    kind: 'forecast',
    title: 'Ennuste muuttui: saapuminen',
    description: 'TPE: 12.46 → 12.52.',
    stationCode: 'TPE',
  },
];

const meta: Meta = {
  title: 'Tietonäkymät/Tilanneanalyysi',
  parameters: {
    docs: {
      description: {
        component:
          'Esimerkkiaineisto havainnollistaa tietojen hierarkiaa. Ei reaaliaikaista liikennetietoa.',
      },
    },
  },
};
export default meta;
type Story = StoryObj;

export const Tutkimustyonkulku: Story = {
  name: 'Junan tutkiminen · esimerkkiaineisto',
  render: () =>
    html`<div style="padding:24px">
      <raide-investigation
        .trains=${trains}
        .stations=${stations}
        .locations=${[]}
        .notices=${[]}
        .observations=${observations}
        selected="2026-11-22/23"
        mode="recorded"
        updatedAt="2026-11-22T10:20:00Z"
        .now=${Date.parse('2026-11-22T10:20:00Z')}
      ></raide-investigation>
    </div>`,
};

export const AikataulunKuusiEsitystapaa: Story = {
  name: 'Kuusi aikataulun esitystapaa · esimerkkiaineisto',
  render: () =>
    html`<div style="padding:24px">
      <raide-timetable
        .trains=${trains}
        .stations=${stations}
        selected="2026-11-22/23"
        .expanded=${true}
        .now=${Date.parse('2026-11-22T10:20:00Z')}
      ></raide-timetable>
    </div>`,
};

export const ViivekartanKomponentti: Story = {
  name: 'Viivekartta · esimerkkiaineisto',
  render: () =>
    html`<div style="padding:24px">
      <raide-heatmap
        .trains=${trains}
        .codes=${['HKI', 'TPE', 'OL']}
        .stations=${stations}
        .from=${Date.parse('2026-11-22T10:00:00Z')}
        .to=${Date.parse('2026-11-22T12:00:00Z')}
        metric="delayed"
      ></raide-heatmap>
    </div>`,
};

export const LiikennevirranKomponentti: Story = {
  name: 'Liikennevirta · esimerkkiaineisto',
  render: () =>
    html`<div style="padding:24px">
      <raide-traffic-flow
        .trains=${trains}
        .codes=${['HKI', 'TPE', 'OL']}
        .stations=${stations}
        .from=${Date.parse('2026-11-22T09:00:00Z')}
        .to=${Date.parse('2026-11-22T11:00:00Z')}
        .bucket=${15}
      ></raide-traffic-flow>
    </div>`,
};

export const LiikenteenNeljaEsitystapaa: Story = {
  name: 'Neljä liikenteen esitystapaa · esimerkkiaineisto',
  render: () =>
    html`<div style="padding:24px;max-width:1120px;min-height:770px">
      <raide-traffic-views
        .trains=${trains}
        .network=${trains}
        .stations=${stations}
        .locations=${[]}
        selected="2026-11-22/23"
        .now=${Date.parse('2026-11-22T10:20:00Z')}
      ></raide-traffic-views>
    </div>`,
};
