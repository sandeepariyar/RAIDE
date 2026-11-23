export const corridors: Record<string, { name: string; stations: string[]; qualifiers: string[] }> =
  {
    commuter: {
      name: 'Helsinki–Riihimäki',
      stations: ['HKI', 'PSL', 'TKL', 'KE', 'JP', 'HY', 'RI'],
      qualifiers: ['RI', 'HY', 'JP', 'KE'],
    },
    west: {
      name: 'Helsinki–Tampere–Oulu',
      stations: ['HKI', 'PSL', 'TKL', 'RI', 'HL', 'TPE', 'PKO', 'SK', 'KOK', 'YV', 'OL'],
      qualifiers: ['RI', 'HL', 'TPE', 'PKO', 'SK', 'KOK', 'YV', 'OL'],
    },
    north: {
      name: 'Oulu–Rovaniemi–Kemijärvi',
      stations: ['OL', 'KEM', 'TUV', 'ROI', 'MIS', 'KJÄ'],
      qualifiers: ['KEM', 'TUV', 'ROI', 'MIS', 'KJÄ'],
    },
    east: {
      name: 'Helsinki–Kouvola–Joensuu',
      stations: ['HKI', 'TKL', 'LH', 'KV', 'LR', 'JTS', 'IMR', 'PAR', 'KTI', 'KIT', 'JNS'],
      qualifiers: ['LH', 'KV', 'LR', 'JTS', 'IMR', 'PAR', 'KTI', 'KIT', 'JNS'],
    },
    turku: {
      name: 'Helsinki–Turku',
      stations: ['HKI', 'PSL', 'LPV', 'KKN', 'KR', 'SLO', 'KUT', 'TKU'],
      qualifiers: ['KKN', 'KR', 'SLO', 'KUT', 'TKU'],
    },
    central: {
      name: 'Tampere–Jyväskylä–Kuopio',
      stations: ['TPE', 'OV', 'JÄS', 'JY', 'HKS', 'PM', 'SNJ', 'KUO'],
      qualifiers: ['OV', 'JÄS', 'JY', 'HKS', 'PM', 'SNJ', 'KUO'],
    },
  };
