/**
 * Australian towns/cities for dense map labels.
 * Sourced from SimpleMaps free AU cities dataset (population-ranked).
 */

export type AuTown = {
  name: string;
  lat: number;
  lon: number;
  state: string;
  population: number;
};

export const AU_TOWNS: AuTown[] = [
  {
    "name": "Sydney",
    "lat": -33.8678,
    "lon": 151.21,
    "state": "New South Wales",
    "population": 5450496
  },
  {
    "name": "Melbourne",
    "lat": -37.8142,
    "lon": 144.9631,
    "state": "Victoria",
    "population": 5350705
  },
  {
    "name": "Brisbane",
    "lat": -27.4678,
    "lon": 153.0278,
    "state": "Queensland",
    "population": 2706966
  },
  {
    "name": "Perth",
    "lat": -31.9558,
    "lon": 115.8597,
    "state": "Western Australia",
    "population": 2141834
  },
  {
    "name": "Adelaide",
    "lat": -34.9275,
    "lon": 138.6,
    "state": "South Australia",
    "population": 1387290
  },
  {
    "name": "Gold Coast",
    "lat": -28.0167,
    "lon": 153.4,
    "state": "Queensland",
    "population": 607665
  },
  {
    "name": "Canberra",
    "lat": -35.2931,
    "lon": 149.1269,
    "state": "Australian Capital Territory",
    "population": 381488
  },
  {
    "name": "Central Coast",
    "lat": -33.2992,
    "lon": 151.1922,
    "state": "New South Wales",
    "population": 325255
  },
  {
    "name": "Wollongong",
    "lat": -34.4331,
    "lon": 150.8831,
    "state": "New South Wales",
    "population": 261896
  },
  {
    "name": "Ipswich",
    "lat": -27.6167,
    "lon": 152.7667,
    "state": "Queensland",
    "population": 232930
  },
  {
    "name": "Hobart",
    "lat": -42.8833,
    "lon": 147.3167,
    "state": "Tasmania",
    "population": 197451
  },
  {
    "name": "Geelong",
    "lat": -38.15,
    "lon": 144.35,
    "state": "Victoria",
    "population": 180239
  },
  {
    "name": "Townsville",
    "lat": -19.2622,
    "lon": 146.8158,
    "state": "Queensland",
    "population": 173724
  },
  {
    "name": "Newcastle",
    "lat": -32.9167,
    "lon": 151.75,
    "state": "New South Wales",
    "population": 152984
  },
  {
    "name": "Cairns",
    "lat": -16.9256,
    "lon": 145.7753,
    "state": "Queensland",
    "population": 146778
  },
  {
    "name": "Darwin",
    "lat": -12.4381,
    "lon": 130.8411,
    "state": "Northern Territory",
    "population": 139902
  },
  {
    "name": "Ballarat",
    "lat": -37.5608,
    "lon": 143.8475,
    "state": "Victoria",
    "population": 116201
  },
  {
    "name": "Toowoomba",
    "lat": -27.55,
    "lon": 151.95,
    "state": "Queensland",
    "population": 108398
  },
  {
    "name": "Mandurah",
    "lat": -32.5289,
    "lon": 115.7231,
    "state": "Western Australia",
    "population": 107643
  },
  {
    "name": "Bendigo",
    "lat": -36.75,
    "lon": 144.2667,
    "state": "Victoria",
    "population": 103034
  },
  {
    "name": "Maitland",
    "lat": -32.7317,
    "lon": 151.5511,
    "state": "New South Wales",
    "population": 89597
  },
  {
    "name": "Launceston",
    "lat": -41.4444,
    "lon": 147.1378,
    "state": "Tasmania",
    "population": 80943
  },
  {
    "name": "Mackay",
    "lat": -21.1411,
    "lon": 149.1861,
    "state": "Queensland",
    "population": 80455
  },
  {
    "name": "Melton",
    "lat": -37.6833,
    "lon": 144.5833,
    "state": "Victoria",
    "population": 76346
  },
  {
    "name": "Bunbury",
    "lat": -33.3272,
    "lon": 115.6369,
    "state": "Western Australia",
    "population": 75196
  },
  {
    "name": "Bundaberg",
    "lat": -24.85,
    "lon": 152.35,
    "state": "Queensland",
    "population": 70540
  },
  {
    "name": "Wagga Wagga",
    "lat": -35.1194,
    "lon": 147.3667,
    "state": "New South Wales",
    "population": 67364
  },
  {
    "name": "Maroochydore",
    "lat": -26.65,
    "lon": 153.1,
    "state": "Queensland",
    "population": 63673
  },
  {
    "name": "Rockhampton",
    "lat": -23.379,
    "lon": 150.5109,
    "state": "Queensland",
    "population": 63151
  },
  {
    "name": "Buderim",
    "lat": -26.685,
    "lon": 153.053,
    "state": "Queensland",
    "population": 58956
  },
  {
    "name": "Hervey Bay",
    "lat": -25.2853,
    "lon": 152.8728,
    "state": "Queensland",
    "population": 57722
  },
  {
    "name": "Pakenham",
    "lat": -38.0712,
    "lon": 145.4878,
    "state": "Victoria",
    "population": 54118
  },
  {
    "name": "Port Macquarie",
    "lat": -31.4317,
    "lon": 152.9178,
    "state": "New South Wales",
    "population": 44830
  },
  {
    "name": "Caloundra",
    "lat": -26.7986,
    "lon": 153.1289,
    "state": "Queensland",
    "population": 41293
  },
  {
    "name": "Orange",
    "lat": -33.2817,
    "lon": 149.1011,
    "state": "New South Wales",
    "population": 41232
  },
  {
    "name": "Sunbury",
    "lat": -37.5811,
    "lon": 144.714,
    "state": "Victoria",
    "population": 38851
  },
  {
    "name": "Dubbo",
    "lat": -32.2483,
    "lon": 148.6011,
    "state": "New South Wales",
    "population": 38783
  },
  {
    "name": "Frankston",
    "lat": -38.158,
    "lon": 145.135,
    "state": "Victoria",
    "population": 37331
  },
  {
    "name": "Southport",
    "lat": -27.9667,
    "lon": 153.4,
    "state": "Queensland",
    "population": 36786
  },
  {
    "name": "Bathurst",
    "lat": -33.42,
    "lon": 149.5778,
    "state": "New South Wales",
    "population": 36230
  },
  {
    "name": "Tamworth",
    "lat": -31.0906,
    "lon": 150.9317,
    "state": "New South Wales",
    "population": 35415
  },
  {
    "name": "Gladstone",
    "lat": -23.8436,
    "lon": 151.2519,
    "state": "Queensland",
    "population": 34703
  },
  {
    "name": "Mildura",
    "lat": -34.2111,
    "lon": 142.1338,
    "state": "Victoria",
    "population": 34565
  },
  {
    "name": "Geraldton",
    "lat": -28.7792,
    "lon": 114.6144,
    "state": "Western Australia",
    "population": 32717
  },
  {
    "name": "Shepparton",
    "lat": -36.3833,
    "lon": 145.4,
    "state": "Victoria",
    "population": 32067
  },
  {
    "name": "Fremantle",
    "lat": -32.0542,
    "lon": 115.7475,
    "state": "Western Australia",
    "population": 31930
  },
  {
    "name": "Albany",
    "lat": -35.0228,
    "lon": 117.8814,
    "state": "Western Australia",
    "population": 31128
  },
  {
    "name": "Alice Springs",
    "lat": -23.7,
    "lon": 133.8667,
    "state": "Northern Territory",
    "population": 31120
  },
  {
    "name": "Kalgoorlie",
    "lat": -30.7489,
    "lon": 121.4661,
    "state": "Western Australia",
    "population": 30841
  },
  {
    "name": "Dandenong",
    "lat": -37.981,
    "lon": 145.215,
    "state": "Victoria",
    "population": 30127
  },
  {
    "name": "Warrnambool",
    "lat": -38.3833,
    "lon": 142.4833,
    "state": "Victoria",
    "population": 29661
  },
  {
    "name": "Caboolture",
    "lat": -27.0667,
    "lon": 152.967,
    "state": "Queensland",
    "population": 29534
  },
  {
    "name": "Armidale",
    "lat": -30.5,
    "lon": 151.6667,
    "state": "New South Wales",
    "population": 28967
  },
  {
    "name": "Gawler",
    "lat": -34.5981,
    "lon": 138.745,
    "state": "South Australia",
    "population": 28562
  },
  {
    "name": "Lismore",
    "lat": -28.8067,
    "lon": 153.2858,
    "state": "New South Wales",
    "population": 27916
  },
  {
    "name": "Quakers Hill",
    "lat": -33.7344,
    "lon": 150.8789,
    "state": "New South Wales",
    "population": 27893
  },
  {
    "name": "Coffs Harbour",
    "lat": -30.3023,
    "lon": 153.1189,
    "state": "New South Wales",
    "population": 27089
  },
  {
    "name": "Mount Gambier",
    "lat": -37.8294,
    "lon": 140.7828,
    "state": "South Australia",
    "population": 25591
  },
  {
    "name": "Traralgon",
    "lat": -38.1958,
    "lon": 146.54,
    "state": "Victoria",
    "population": 24933
  },
  {
    "name": "Devonport",
    "lat": -41.18,
    "lon": 146.3503,
    "state": "Tasmania",
    "population": 24591
  },
  {
    "name": "Cessnock",
    "lat": -32.8333,
    "lon": 151.3561,
    "state": "New South Wales",
    "population": 23211
  },
  {
    "name": "Maryborough",
    "lat": -25.5375,
    "lon": 152.7019,
    "state": "Queensland",
    "population": 22237
  },
  {
    "name": "Mount Barker",
    "lat": -35.0667,
    "lon": 138.85,
    "state": "South Australia",
    "population": 21554
  },
  {
    "name": "Whyalla",
    "lat": -33.0327,
    "lon": 137.5648,
    "state": "South Australia",
    "population": 21501
  },
  {
    "name": "Cranbourne",
    "lat": -38.105,
    "lon": 145.279,
    "state": "Victoria",
    "population": 21281
  },
  {
    "name": "Nambour",
    "lat": -26.6269,
    "lon": 152.9592,
    "state": "Queensland",
    "population": 20918
  },
  {
    "name": "Griffith",
    "lat": -34.2817,
    "lon": 146.0344,
    "state": "New South Wales",
    "population": 20799
  },
  {
    "name": "Burnie",
    "lat": -41.0636,
    "lon": 145.8919,
    "state": "Tasmania",
    "population": 20417
  },
  {
    "name": "Wodonga",
    "lat": -36.1214,
    "lon": 146.8881,
    "state": "Victoria",
    "population": 20259
  },
  {
    "name": "Coomera",
    "lat": -27.8568,
    "lon": 153.3205,
    "state": "Queensland",
    "population": 20225
  },
  {
    "name": "Kurri Kurri",
    "lat": -32.8144,
    "lon": 151.4806,
    "state": "New South Wales",
    "population": 20015
  },
  {
    "name": "Wangaratta",
    "lat": -36.3583,
    "lon": 146.312,
    "state": "Victoria",
    "population": 19712
  },
  {
    "name": "Gympie",
    "lat": -26.1833,
    "lon": 152.6667,
    "state": "Queensland",
    "population": 19435
  },
  {
    "name": "Lara",
    "lat": -38.022,
    "lon": 144.407,
    "state": "Victoria",
    "population": 19014
  },
  {
    "name": "Yeppoon",
    "lat": -23.1333,
    "lon": 150.7333,
    "state": "Queensland",
    "population": 18789
  },
  {
    "name": "Mount Eliza",
    "lat": -38.189,
    "lon": 145.092,
    "state": "Victoria",
    "population": 18734
  },
  {
    "name": "Taree",
    "lat": -31.915,
    "lon": 152.4511,
    "state": "New South Wales",
    "population": 18110
  },
  {
    "name": "Penrith",
    "lat": -33.7511,
    "lon": 150.6942,
    "state": "New South Wales",
    "population": 17966
  },
  {
    "name": "Mount Isa",
    "lat": -20.7253,
    "lon": 139.495,
    "state": "Queensland",
    "population": 17936
  },
  {
    "name": "Barwon Heads",
    "lat": -38.25,
    "lon": 144.517,
    "state": "Victoria",
    "population": 17714
  },
  {
    "name": "Broken Hill",
    "lat": -31.965,
    "lon": 141.4511,
    "state": "New South Wales",
    "population": 17706
  },
  {
    "name": "Grafton",
    "lat": -29.6817,
    "lon": 152.9344,
    "state": "New South Wales",
    "population": 17155
  },
  {
    "name": "Nerang",
    "lat": -27.9956,
    "lon": 153.322,
    "state": "Queensland",
    "population": 17048
  },
  {
    "name": "Karratha",
    "lat": -20.7364,
    "lon": 116.846,
    "state": "Western Australia",
    "population": 17013
  },
  {
    "name": "Campbelltown",
    "lat": -34.0733,
    "lon": 150.8261,
    "state": "New South Wales",
    "population": 16577
  },
  {
    "name": "Banora Point",
    "lat": -28.2225,
    "lon": 153.5386,
    "state": "New South Wales",
    "population": 16460
  },
  {
    "name": "Australind",
    "lat": -33.28,
    "lon": 115.726,
    "state": "Western Australia",
    "population": 15988
  },
  {
    "name": "Port Hedland",
    "lat": -20.31,
    "lon": 118.6011,
    "state": "Western Australia",
    "population": 15298
  },
  {
    "name": "Drouin",
    "lat": -38.1333,
    "lon": 145.85,
    "state": "Victoria",
    "population": 15287
  },
  {
    "name": "Horsham",
    "lat": -36.7167,
    "lon": 142.2,
    "state": "Victoria",
    "population": 15134
  },
  {
    "name": "Echuca",
    "lat": -36.1333,
    "lon": 144.75,
    "state": "Victoria",
    "population": 15056
  },
  {
    "name": "Murray Bridge",
    "lat": -35.1189,
    "lon": 139.2765,
    "state": "South Australia",
    "population": 15043
  },
  {
    "name": "Wallan",
    "lat": -37.4167,
    "lon": 144.983,
    "state": "Victoria",
    "population": 15004
  },
  {
    "name": "Kiama",
    "lat": -34.665,
    "lon": 150.8511,
    "state": "New South Wales",
    "population": 14761
  },
  {
    "name": "Broome",
    "lat": -17.9619,
    "lon": 122.2361,
    "state": "Western Australia",
    "population": 14660
  },
  {
    "name": "Port Lincoln",
    "lat": -34.7322,
    "lon": 135.8608,
    "state": "South Australia",
    "population": 14458
  },
  {
    "name": "Morwell",
    "lat": -38.2333,
    "lon": 146.4,
    "state": "Victoria",
    "population": 14389
  },
  {
    "name": "Forster",
    "lat": -32.1806,
    "lon": 152.5117,
    "state": "New South Wales",
    "population": 14187
  },
  {
    "name": "Warwick",
    "lat": -28.2172,
    "lon": 152.0347,
    "state": "Queensland",
    "population": 14110
  },
  {
    "name": "Ulverstone",
    "lat": -41.1667,
    "lon": 146.1667,
    "state": "Tasmania",
    "population": 14109
  },
  {
    "name": "Raymond Terrace",
    "lat": -32.7615,
    "lon": 151.7441,
    "state": "New South Wales",
    "population": 14081
  },
  {
    "name": "Goonellabah",
    "lat": -28.8167,
    "lon": 153.3167,
    "state": "New South Wales",
    "population": 13351
  },
  {
    "name": "Leopold",
    "lat": -38.1892,
    "lon": 144.464,
    "state": "Victoria",
    "population": 13272
  },
  {
    "name": "Torquay",
    "lat": -38.3333,
    "lon": 144.3167,
    "state": "Victoria",
    "population": 13258
  },
  {
    "name": "Rutherford",
    "lat": -32.715,
    "lon": 151.5317,
    "state": "New South Wales",
    "population": 13091
  },
  {
    "name": "Kingston",
    "lat": -42.9769,
    "lon": 147.3083,
    "state": "Tasmania",
    "population": 12288
  },
  {
    "name": "Muswellbrook",
    "lat": -32.2667,
    "lon": 150.9,
    "state": "New South Wales",
    "population": 12272
  },
  {
    "name": "Inverell",
    "lat": -29.7667,
    "lon": 151.1167,
    "state": "New South Wales",
    "population": 12057
  },
  {
    "name": "Mareeba",
    "lat": -16.9833,
    "lon": 145.417,
    "state": "Queensland",
    "population": 11825
  },
  {
    "name": "Corinda",
    "lat": -27.4833,
    "lon": 153.1,
    "state": "Queensland",
    "population": 11678
  },
  {
    "name": "Mudgee",
    "lat": -32.6125,
    "lon": 149.5872,
    "state": "New South Wales",
    "population": 11563
  },
  {
    "name": "Parkes",
    "lat": -33.133,
    "lon": 148.176,
    "state": "New South Wales",
    "population": 11408
  },
  {
    "name": "Bowen",
    "lat": -20.0167,
    "lon": 148.2333,
    "state": "Queensland",
    "population": 11205
  },
  {
    "name": "Lithgow",
    "lat": -33.4817,
    "lon": 150.1511,
    "state": "New South Wales",
    "population": 11197
  },
  {
    "name": "Swan Hill",
    "lat": -35.3333,
    "lon": 143.55,
    "state": "Victoria",
    "population": 11186
  },
  {
    "name": "Gisborne",
    "lat": -37.49,
    "lon": 144.589,
    "state": "Victoria",
    "population": 10999
  },
  {
    "name": "Casino",
    "lat": -28.8667,
    "lon": 153.05,
    "state": "New South Wales",
    "population": 10930
  },
  {
    "name": "Bowral",
    "lat": -34.4817,
    "lon": 150.4178,
    "state": "New South Wales",
    "population": 10764
  },
  {
    "name": "Young",
    "lat": -34.3,
    "lon": 148.3,
    "state": "New South Wales",
    "population": 10610
  },
  {
    "name": "Esperance",
    "lat": -33.8611,
    "lon": 121.8919,
    "state": "Western Australia",
    "population": 10218
  },
  {
    "name": "Bli Bli",
    "lat": -26.618,
    "lon": 153.037,
    "state": "Queensland",
    "population": 10138
  },
  {
    "name": "Nowra",
    "lat": -34.8808,
    "lon": 150.6075,
    "state": "New South Wales",
    "population": 9956
  },
  {
    "name": "Andergrove",
    "lat": -21.0931,
    "lon": 149.186,
    "state": "Queensland",
    "population": 9924
  },
  {
    "name": "Murwillumbah",
    "lat": -28.3333,
    "lon": 153.3833,
    "state": "New South Wales",
    "population": 9812
  },
  {
    "name": "Mount Evelyn",
    "lat": -37.783,
    "lon": 145.385,
    "state": "Victoria",
    "population": 9799
  },
  {
    "name": "Burpengary",
    "lat": -27.1442,
    "lon": 153,
    "state": "Queensland",
    "population": 9654
  },
  {
    "name": "Moranbah",
    "lat": -22.0003,
    "lon": 148.0489,
    "state": "Queensland",
    "population": 9425
  },
  {
    "name": "Moe",
    "lat": -38.1749,
    "lon": 146.263,
    "state": "Victoria",
    "population": 9375
  },
  {
    "name": "Moree",
    "lat": -29.465,
    "lon": 149.8344,
    "state": "New South Wales",
    "population": 9311
  },
  {
    "name": "Colac",
    "lat": -38.3333,
    "lon": 143.5833,
    "state": "Victoria",
    "population": 9243
  },
  {
    "name": "Leeton",
    "lat": -34.5483,
    "lon": 146.4011,
    "state": "New South Wales",
    "population": 9170
  },
  {
    "name": "Coolum Beach",
    "lat": -26.5333,
    "lon": 153.1,
    "state": "Queensland",
    "population": 9152
  },
  {
    "name": "Flemington",
    "lat": -33.8633,
    "lon": 151.071,
    "state": "New South Wales",
    "population": 9108
  },
  {
    "name": "Goolwa",
    "lat": -35.5,
    "lon": 138.7667,
    "state": "South Australia",
    "population": 8756
  },
  {
    "name": "Ballina",
    "lat": -28.8417,
    "lon": 153.561,
    "state": "New South Wales",
    "population": 8655
  },
  {
    "name": "Ayr",
    "lat": -19.5833,
    "lon": 147.4,
    "state": "Queensland",
    "population": 8603
  },
  {
    "name": "Ararat",
    "lat": -37.285,
    "lon": 142.933,
    "state": "Victoria",
    "population": 8500
  },
  {
    "name": "Springwood",
    "lat": -33.7036,
    "lon": 150.55,
    "state": "New South Wales",
    "population": 8475
  },
  {
    "name": "Beenleigh",
    "lat": -27.7161,
    "lon": 153.202,
    "state": "Queensland",
    "population": 8425
  },
  {
    "name": "Kingscliff",
    "lat": -28.2617,
    "lon": 153.5769,
    "state": "New South Wales",
    "population": 8355
  },
  {
    "name": "Mooroopna",
    "lat": -36.3833,
    "lon": 145.35,
    "state": "Victoria",
    "population": 8312
  },
  {
    "name": "Katoomba",
    "lat": -33.715,
    "lon": 150.312,
    "state": "New South Wales",
    "population": 8268
  },
  {
    "name": "Merimbula",
    "lat": -36.8983,
    "lon": 149.9011,
    "state": "New South Wales",
    "population": 8220
  },
  {
    "name": "Tweed Heads",
    "lat": -28.1833,
    "lon": 153.55,
    "state": "New South Wales",
    "population": 8176
  },
  {
    "name": "Bongaree",
    "lat": -27.0814,
    "lon": 153.157,
    "state": "Queensland",
    "population": 8162
  },
  {
    "name": "Maryborough",
    "lat": -37.05,
    "lon": 143.735,
    "state": "Victoria",
    "population": 8160
  },
  {
    "name": "Beaudesert",
    "lat": -27.9833,
    "lon": 152.9833,
    "state": "Queensland",
    "population": 8127
  },
  {
    "name": "Charters Towers",
    "lat": -20.0731,
    "lon": 146.2603,
    "state": "Queensland",
    "population": 8040
  },
  {
    "name": "Wauchope",
    "lat": -31.45,
    "lon": 152.7333,
    "state": "New South Wales",
    "population": 7982
  },
  {
    "name": "Urraween",
    "lat": -25.2955,
    "lon": 152.8219,
    "state": "Queensland",
    "population": 7951
  },
  {
    "name": "Bairnsdale",
    "lat": -37.8275,
    "lon": 147.625,
    "state": "Victoria",
    "population": 7905
  },
  {
    "name": "Sanctuary Point",
    "lat": -35.1028,
    "lon": 150.6272,
    "state": "New South Wales",
    "population": 7874
  },
  {
    "name": "Deniliquin",
    "lat": -35.5297,
    "lon": 144.9569,
    "state": "New South Wales",
    "population": 7862
  },
  {
    "name": "Gatton",
    "lat": -27.55,
    "lon": 152.2833,
    "state": "Queensland",
    "population": 7851
  },
  {
    "name": "Claremont",
    "lat": -42.7897,
    "lon": 147.2544,
    "state": "Tasmania",
    "population": 7750
  },
  {
    "name": "Atherton",
    "lat": -17.2656,
    "lon": 145.4742,
    "state": "Queensland",
    "population": 7724
  },
  {
    "name": "Lennox Head",
    "lat": -28.7983,
    "lon": 153.5844,
    "state": "New South Wales",
    "population": 7687
  },
  {
    "name": "Clifton Springs",
    "lat": -38.15,
    "lon": 144.5667,
    "state": "Victoria",
    "population": 7646
  },
  {
    "name": "Narrabri",
    "lat": -30.3317,
    "lon": 149.7678,
    "state": "New South Wales",
    "population": 7606
  },
  {
    "name": "Kyneton",
    "lat": -37.247,
    "lon": 144.455,
    "state": "Victoria",
    "population": 7513
  },
  {
    "name": "Castlemaine",
    "lat": -37.0636,
    "lon": 144.2172,
    "state": "Victoria",
    "population": 7506
  },
  {
    "name": "Blaxland",
    "lat": -33.75,
    "lon": 150.6167,
    "state": "New South Wales",
    "population": 7451
  },
  {
    "name": "Kyabram",
    "lat": -36.3167,
    "lon": 145.05,
    "state": "Victoria",
    "population": 7331
  },
  {
    "name": "Strathalbyn",
    "lat": -35.2667,
    "lon": 138.9,
    "state": "South Australia",
    "population": 7246
  },
  {
    "name": "Moama",
    "lat": -36.0983,
    "lon": 144.7511,
    "state": "New South Wales",
    "population": 7213
  },
  {
    "name": "Merrimac",
    "lat": -28.05,
    "lon": 153.3667,
    "state": "Queensland",
    "population": 7212
  },
  {
    "name": "Innisfail",
    "lat": -17.5236,
    "lon": 146.0292,
    "state": "Queensland",
    "population": 7173
  },
  {
    "name": "Gordonvale",
    "lat": -17.0972,
    "lon": 145.7792,
    "state": "Queensland",
    "population": 6944
  },
  {
    "name": "Waterford",
    "lat": -27.6906,
    "lon": 153.1332,
    "state": "Queensland",
    "population": 6942
  },
  {
    "name": "Nuriootpa",
    "lat": -34.468,
    "lon": 138.99,
    "state": "South Australia",
    "population": 6901
  },
  {
    "name": "Cootamundra",
    "lat": -34.6483,
    "lon": 148.0344,
    "state": "New South Wales",
    "population": 6885
  },
  {
    "name": "Roma",
    "lat": -26.55,
    "lon": 148.8,
    "state": "Queensland",
    "population": 6848
  },
  {
    "name": "Yass",
    "lat": -34.8203,
    "lon": 148.9136,
    "state": "New South Wales",
    "population": 6763
  },
  {
    "name": "Bomaderry",
    "lat": -34.8483,
    "lon": 150.6178,
    "state": "New South Wales",
    "population": 6738
  },
  {
    "name": "Dromana",
    "lat": -38.338,
    "lon": 144.965,
    "state": "Victoria",
    "population": 6626
  },
  {
    "name": "Tumut",
    "lat": -35.3039,
    "lon": 148.2233,
    "state": "New South Wales",
    "population": 6613
  },
  {
    "name": "Cannonvale",
    "lat": -20.2787,
    "lon": 148.6994,
    "state": "Queensland",
    "population": 6596
  },
  {
    "name": "Helensburgh",
    "lat": -34.1889,
    "lon": 150.9811,
    "state": "New South Wales",
    "population": 6576
  },
  {
    "name": "Seymour",
    "lat": -37.03,
    "lon": 145.13,
    "state": "Victoria",
    "population": 6569
  },
  {
    "name": "Port Augusta",
    "lat": -32.4925,
    "lon": 137.7658,
    "state": "South Australia",
    "population": 6562
  },
  {
    "name": "Inverloch",
    "lat": -38.6333,
    "lon": 145.7167,
    "state": "Victoria",
    "population": 6526
  },
  {
    "name": "Yamba",
    "lat": -29.44,
    "lon": 153.3594,
    "state": "New South Wales",
    "population": 6405
  },
  {
    "name": "Bacchus Marsh",
    "lat": -37.675,
    "lon": 144.4389,
    "state": "Victoria",
    "population": 6394
  },
  {
    "name": "Tuncurry",
    "lat": -32.1644,
    "lon": 152.4894,
    "state": "New South Wales",
    "population": 6376
  },
  {
    "name": "Palmwoods",
    "lat": -26.6858,
    "lon": 152.9613,
    "state": "Queensland",
    "population": 6357
  },
  {
    "name": "Goondiwindi",
    "lat": -28.5444,
    "lon": 150.3106,
    "state": "New South Wales",
    "population": 6355
  },
  {
    "name": "Wynyard",
    "lat": -41,
    "lon": 145.7167,
    "state": "Tasmania",
    "population": 6296
  },
  {
    "name": "Queanbeyan",
    "lat": -35.3533,
    "lon": 149.2342,
    "state": "Australian Capital Territory",
    "population": 6237
  },
  {
    "name": "Stawell",
    "lat": -37.057,
    "lon": 142.78,
    "state": "Victoria",
    "population": 6220
  },
  {
    "name": "North Mackay",
    "lat": -21.1216,
    "lon": 149.1783,
    "state": "Queensland",
    "population": 6194
  },
  {
    "name": "New Norfolk",
    "lat": -42.7828,
    "lon": 147.0594,
    "state": "Tasmania",
    "population": 6153
  },
  {
    "name": "Woolgoolga",
    "lat": -30.115,
    "lon": 153.2011,
    "state": "New South Wales",
    "population": 6151
  },
  {
    "name": "Nelson Bay",
    "lat": -32.715,
    "lon": 152.1511,
    "state": "New South Wales",
    "population": 6141
  },
  {
    "name": "Mittagong",
    "lat": -34.4483,
    "lon": 150.4511,
    "state": "New South Wales",
    "population": 6090
  },
  {
    "name": "Alstonville",
    "lat": -28.8317,
    "lon": 153.4344,
    "state": "New South Wales",
    "population": 5912
  },
  {
    "name": "Scone",
    "lat": -32.0483,
    "lon": 150.8678,
    "state": "New South Wales",
    "population": 5824
  },
  {
    "name": "Tahmoor",
    "lat": -34.2233,
    "lon": 150.5928,
    "state": "New South Wales",
    "population": 5777
  },
  {
    "name": "Biloela",
    "lat": -24.3991,
    "lon": 150.5166,
    "state": "Queensland",
    "population": 5758
  },
  {
    "name": "Point Vernon",
    "lat": -25.2538,
    "lon": 152.8177,
    "state": "Queensland",
    "population": 5718
  },
  {
    "name": "Leongatha",
    "lat": -38.4833,
    "lon": 145.95,
    "state": "Victoria",
    "population": 5654
  },
  {
    "name": "Corowa",
    "lat": -35.9986,
    "lon": 146.3911,
    "state": "New South Wales",
    "population": 5595
  },
  {
    "name": "Kununurra",
    "lat": -15.7736,
    "lon": 128.739,
    "state": "Western Australia",
    "population": 5494
  },
  {
    "name": "Maddingley",
    "lat": -37.6864,
    "lon": 144.4336,
    "state": "Victoria",
    "population": 5491
  },
  {
    "name": "Richmond",
    "lat": -33.5983,
    "lon": 150.7511,
    "state": "New South Wales",
    "population": 5482
  },
  {
    "name": "Maffra",
    "lat": -37.95,
    "lon": 146.983,
    "state": "Victoria",
    "population": 5384
  },
  {
    "name": "Worragee",
    "lat": -34.9144,
    "lon": 150.6386,
    "state": "New South Wales",
    "population": 5384
  },
  {
    "name": "Nairne",
    "lat": -35.0333,
    "lon": 138.917,
    "state": "South Australia",
    "population": 5327
  },
  {
    "name": "Encounter Bay",
    "lat": -35.5742,
    "lon": 138.6005,
    "state": "South Australia",
    "population": 5305
  },
  {
    "name": "Red Cliffs",
    "lat": -34.3075,
    "lon": 142.1881,
    "state": "Victoria",
    "population": 5294
  },
  {
    "name": "Picton",
    "lat": -34.1817,
    "lon": 150.6011,
    "state": "New South Wales",
    "population": 5282
  },
  {
    "name": "Tannum Sands",
    "lat": -23.95,
    "lon": 151.367,
    "state": "Queensland",
    "population": 5227
  },
  {
    "name": "Old Bar",
    "lat": -31.9667,
    "lon": 152.583,
    "state": "New South Wales",
    "population": 5126
  },
  {
    "name": "Millicent",
    "lat": -37.5833,
    "lon": 140.35,
    "state": "South Australia",
    "population": 5110
  },
  {
    "name": "Kiama Downs",
    "lat": -34.6317,
    "lon": 150.8511,
    "state": "New South Wales",
    "population": 5087
  },
  {
    "name": "Hazelbrook",
    "lat": -33.7333,
    "lon": 150.45,
    "state": "New South Wales",
    "population": 5077
  },
  {
    "name": "Latrobe",
    "lat": -41.2464,
    "lon": 146.4246,
    "state": "Tasmania",
    "population": 5030
  },
  {
    "name": "Thirlmere",
    "lat": -34.2,
    "lon": 150.5667,
    "state": "New South Wales",
    "population": 4986
  },
  {
    "name": "Drysdale",
    "lat": -38.1667,
    "lon": 144.5667,
    "state": "Victoria",
    "population": 4976
  },
  {
    "name": "Peregian Beach",
    "lat": -26.481,
    "lon": 153.096,
    "state": "Queensland",
    "population": 4972
  },
  {
    "name": "Albury",
    "lat": -36.0733,
    "lon": 146.9144,
    "state": "New South Wales",
    "population": 4955
  },
  {
    "name": "Tatura",
    "lat": -36.4401,
    "lon": 145.233,
    "state": "Victoria",
    "population": 4955
  },
  {
    "name": "Churchill",
    "lat": -38.3167,
    "lon": 146.417,
    "state": "Victoria",
    "population": 4924
  },
  {
    "name": "Gosford",
    "lat": -33.4233,
    "lon": 151.3414,
    "state": "New South Wales",
    "population": 4873
  },
  {
    "name": "Boulder",
    "lat": -30.7819,
    "lon": 121.4886,
    "state": "Western Australia",
    "population": 4872
  },
  {
    "name": "Cooroy",
    "lat": -26.433,
    "lon": 152.905,
    "state": "Queensland",
    "population": 4801
  },
  {
    "name": "Beachmere",
    "lat": -27.13,
    "lon": 153.052,
    "state": "Queensland",
    "population": 4782
  },
  {
    "name": "Korumburra",
    "lat": -38.4333,
    "lon": 145.8167,
    "state": "Victoria",
    "population": 4749
  },
  {
    "name": "Legana",
    "lat": -41.3667,
    "lon": 147.05,
    "state": "Tasmania",
    "population": 4719
  },
  {
    "name": "Tanunda",
    "lat": -34.5167,
    "lon": 138.967,
    "state": "South Australia",
    "population": 4710
  },
  {
    "name": "Temora",
    "lat": -34.4483,
    "lon": 147.5344,
    "state": "New South Wales",
    "population": 4706
  },
  {
    "name": "Renmark",
    "lat": -34.1667,
    "lon": 140.7333,
    "state": "South Australia",
    "population": 4705
  },
  {
    "name": "Loxton",
    "lat": -34.45,
    "lon": 140.5667,
    "state": "South Australia",
    "population": 4677
  },
  {
    "name": "Rasmussen",
    "lat": -19.3497,
    "lon": 146.716,
    "state": "Queensland",
    "population": 4669
  },
  {
    "name": "Landsborough",
    "lat": -26.8,
    "lon": 152.967,
    "state": "Queensland",
    "population": 4635
  },
  {
    "name": "Numurkah",
    "lat": -36.0833,
    "lon": 145.4333,
    "state": "Victoria",
    "population": 4604
  },
  {
    "name": "Wellington",
    "lat": -32.5483,
    "lon": 148.9344,
    "state": "New South Wales",
    "population": 4581
  },
  {
    "name": "Gerringong",
    "lat": -34.7483,
    "lon": 150.8344,
    "state": "New South Wales",
    "population": 4565
  },
  {
    "name": "Glenella",
    "lat": -21.1197,
    "lon": 149.1542,
    "state": "Queensland",
    "population": 4545
  },
  {
    "name": "Silverdale",
    "lat": -33.915,
    "lon": 150.6094,
    "state": "New South Wales",
    "population": 4543
  },
  {
    "name": "George Town",
    "lat": -41.1,
    "lon": 146.8167,
    "state": "Tasmania",
    "population": 4536
  },
  {
    "name": "Victor Harbor",
    "lat": -35.55,
    "lon": 138.6167,
    "state": "South Australia",
    "population": 4520
  },
  {
    "name": "Narrandera",
    "lat": -34.7483,
    "lon": 146.5511,
    "state": "New South Wales",
    "population": 4375
  },
  {
    "name": "Trafalgar",
    "lat": -38.2,
    "lon": 146.15,
    "state": "Victoria",
    "population": 4349
  },
  {
    "name": "Broadford",
    "lat": -37.2,
    "lon": 145.067,
    "state": "Victoria",
    "population": 4319
  },
  {
    "name": "Lake Cathie",
    "lat": -31.5483,
    "lon": 152.8511,
    "state": "New South Wales",
    "population": 4296
  },
  {
    "name": "Longford",
    "lat": -41.5958,
    "lon": 147.122,
    "state": "Tasmania",
    "population": 4268
  },
  {
    "name": "The Entrance",
    "lat": -33.3472,
    "lon": 151.496,
    "state": "New South Wales",
    "population": 4244
  },
  {
    "name": "Anna Bay",
    "lat": -32.7817,
    "lon": 152.0844,
    "state": "New South Wales",
    "population": 4241
  },
  {
    "name": "Margate",
    "lat": -43.0294,
    "lon": 147.2617,
    "state": "Tasmania",
    "population": 4239
  },
  {
    "name": "Suffolk Park",
    "lat": -28.6983,
    "lon": 153.6178,
    "state": "New South Wales",
    "population": 4222
  },
  {
    "name": "Curlewis",
    "lat": -38.1833,
    "lon": 144.5,
    "state": "Victoria",
    "population": 4175
  },
  {
    "name": "Carnarvon",
    "lat": -24.8839,
    "lon": 113.6569,
    "state": "Western Australia",
    "population": 4162
  },
  {
    "name": "Berri",
    "lat": -34.2833,
    "lon": 140.6,
    "state": "South Australia",
    "population": 4143
  },
  {
    "name": "Penguin",
    "lat": -41.1167,
    "lon": 146.0708,
    "state": "Tasmania",
    "population": 4132
  },
  {
    "name": "Sandstone Point",
    "lat": -27.0833,
    "lon": 153.133,
    "state": "Queensland",
    "population": 4094
  },
  {
    "name": "Weston",
    "lat": -32.8103,
    "lon": 151.4561,
    "state": "New South Wales",
    "population": 4088
  },
  {
    "name": "Somerset",
    "lat": -41.05,
    "lon": 145.8333,
    "state": "Tasmania",
    "population": 4067
  },
  {
    "name": "McLaren Vale",
    "lat": -35.2333,
    "lon": 138.533,
    "state": "South Australia",
    "population": 4061
  },
  {
    "name": "Koo-Wee-Rup",
    "lat": -38.198,
    "lon": 145.489,
    "state": "Victoria",
    "population": 4047
  },
  {
    "name": "Kerang",
    "lat": -35.7167,
    "lon": 143.9167,
    "state": "Victoria",
    "population": 3960
  },
  {
    "name": "Smithton",
    "lat": -40.844,
    "lon": 145.12,
    "state": "Tasmania",
    "population": 3934
  },
  {
    "name": "Bellingen",
    "lat": -30.4483,
    "lon": 152.9011,
    "state": "New South Wales",
    "population": 3923
  },
  {
    "name": "Roxby Downs",
    "lat": -30.55,
    "lon": 136.9,
    "state": "South Australia",
    "population": 3884
  },
  {
    "name": "Vincentia",
    "lat": -35.0758,
    "lon": 150.6742,
    "state": "New South Wales",
    "population": 3870
  },
  {
    "name": "Pearcedale",
    "lat": -38.203,
    "lon": 145.231,
    "state": "Victoria",
    "population": 3867
  },
  {
    "name": "Bay View",
    "lat": -33.6592,
    "lon": 151.2861,
    "state": "New South Wales",
    "population": 3807
  },
  {
    "name": "Buninyong",
    "lat": -37.6503,
    "lon": 143.8839,
    "state": "Victoria",
    "population": 3797
  },
  {
    "name": "Sawtell",
    "lat": -30.365,
    "lon": 153.1011,
    "state": "New South Wales",
    "population": 3788
  },
  {
    "name": "Scarness",
    "lat": -25.2833,
    "lon": 152.85,
    "state": "Queensland",
    "population": 3646
  },
  {
    "name": "Paynesville",
    "lat": -37.9167,
    "lon": 147.7167,
    "state": "Victoria",
    "population": 3636
  },
  {
    "name": "Walkerston",
    "lat": -21.1667,
    "lon": 149.067,
    "state": "Queensland",
    "population": 3615
  },
  {
    "name": "Proserpine",
    "lat": -20.4042,
    "lon": 148.5833,
    "state": "Queensland",
    "population": 3614
  },
  {
    "name": "Hurstbridge",
    "lat": -37.6389,
    "lon": 145.195,
    "state": "Victoria",
    "population": 3554
  },
  {
    "name": "Robinvale",
    "lat": -34.5833,
    "lon": 142.7667,
    "state": "New South Wales",
    "population": 3497
  },
  {
    "name": "Condobolin",
    "lat": -33.065,
    "lon": 147.1511,
    "state": "New South Wales",
    "population": 3486
  },
  {
    "name": "North Wonthaggi",
    "lat": -38.6,
    "lon": 145.6,
    "state": "Victoria",
    "population": 3475
  },
  {
    "name": "Perth",
    "lat": -41.5731,
    "lon": 147.1714,
    "state": "Tasmania",
    "population": 3472
  },
  {
    "name": "Harvey",
    "lat": -33.08,
    "lon": 115.89,
    "state": "Western Australia",
    "population": 3462
  },
  {
    "name": "Blayney",
    "lat": -33.5317,
    "lon": 149.2511,
    "state": "New South Wales",
    "population": 3448
  },
  {
    "name": "Tura Beach",
    "lat": -36.8483,
    "lon": 149.9261,
    "state": "New South Wales",
    "population": 3405
  },
  {
    "name": "Narooma",
    "lat": -36.215,
    "lon": 150.1344,
    "state": "New South Wales",
    "population": 3395
  },
  {
    "name": "Camperdown",
    "lat": -38.236,
    "lon": 143.145,
    "state": "Victoria",
    "population": 3369
  },
  {
    "name": "Terranora",
    "lat": -28.2456,
    "lon": 153.5025,
    "state": "New South Wales",
    "population": 3365
  },
  {
    "name": "Marcoola",
    "lat": -26.5833,
    "lon": 153.083,
    "state": "Queensland",
    "population": 3355
  },
  {
    "name": "Eden",
    "lat": -37.065,
    "lon": 149.9011,
    "state": "New South Wales",
    "population": 3350
  },
  {
    "name": "Greta",
    "lat": -32.6872,
    "lon": 151.3844,
    "state": "New South Wales",
    "population": 3349
  },
  {
    "name": "Bogangar",
    "lat": -28.3317,
    "lon": 153.5594,
    "state": "New South Wales",
    "population": 3313
  },
  {
    "name": "Pittsworth",
    "lat": -27.7167,
    "lon": 151.633,
    "state": "Queensland",
    "population": 3300
  },
  {
    "name": "Tea Gardens",
    "lat": -32.6272,
    "lon": 152.17,
    "state": "New South Wales",
    "population": 3288
  },
  {
    "name": "Shoalhaven Heads",
    "lat": -34.85,
    "lon": 150.7417,
    "state": "New South Wales",
    "population": 3264
  },
  {
    "name": "Saint Georges Basin",
    "lat": -35.13,
    "lon": 150.6267,
    "state": "New South Wales",
    "population": 3215
  },
  {
    "name": "Urunga",
    "lat": -30.4983,
    "lon": 153.0178,
    "state": "New South Wales",
    "population": 3185
  },
  {
    "name": "West Wyalong",
    "lat": -33.9317,
    "lon": 147.2011,
    "state": "New South Wales",
    "population": 3141
  },
  {
    "name": "Gilgandra",
    "lat": -31.7067,
    "lon": 148.6678,
    "state": "New South Wales",
    "population": 3126
  },
  {
    "name": "Longreach",
    "lat": -23.45,
    "lon": 144.25,
    "state": "Queensland",
    "population": 3124
  },
  {
    "name": "Bonny Hills",
    "lat": -31.5817,
    "lon": 152.8344,
    "state": "New South Wales",
    "population": 3045
  },
  {
    "name": "Yarra Glen",
    "lat": -37.6489,
    "lon": 145.3719,
    "state": "Victoria",
    "population": 3012
  },
  {
    "name": "Beaconsfield Upper",
    "lat": -37.996,
    "lon": 145.415,
    "state": "Victoria",
    "population": 2997
  },
  {
    "name": "Howlong",
    "lat": -35.9667,
    "lon": 146.6333,
    "state": "New South Wales",
    "population": 2997
  },
  {
    "name": "Jindabyne",
    "lat": -36.415,
    "lon": 148.6178,
    "state": "New South Wales",
    "population": 2986
  },
  {
    "name": "The Oaks",
    "lat": -34.0817,
    "lon": 150.5678,
    "state": "New South Wales",
    "population": 2982
  },
  {
    "name": "Williamstown",
    "lat": -34.6667,
    "lon": 138.883,
    "state": "South Australia",
    "population": 2981
  },
  {
    "name": "Stirling",
    "lat": -35.0022,
    "lon": 138.706,
    "state": "South Australia",
    "population": 2966
  },
  {
    "name": "Woori Yallock",
    "lat": -37.778,
    "lon": 145.528,
    "state": "Victoria",
    "population": 2964
  },
  {
    "name": "Home Hill",
    "lat": -19.6592,
    "lon": 147.4122,
    "state": "Queensland",
    "population": 2954
  },
  {
    "name": "Kapunda",
    "lat": -34.337,
    "lon": 138.916,
    "state": "South Australia",
    "population": 2947
  },
  {
    "name": "Culburra",
    "lat": -34.9347,
    "lon": 150.7539,
    "state": "New South Wales",
    "population": 2946
  },
  {
    "name": "Sandy Beach",
    "lat": -30.1483,
    "lon": 153.2011,
    "state": "New South Wales",
    "population": 2913
  },
  {
    "name": "Deloraine",
    "lat": -41.5333,
    "lon": 146.6667,
    "state": "Tasmania",
    "population": 2848
  },
  {
    "name": "Heddon Greta",
    "lat": -32.8019,
    "lon": 151.5133,
    "state": "New South Wales",
    "population": 2838
  },
  {
    "name": "Hahndorf",
    "lat": -35.0167,
    "lon": 138.8167,
    "state": "South Australia",
    "population": 2814
  },
  {
    "name": "Thursday Island",
    "lat": -10.579,
    "lon": 142.22,
    "state": "Queensland",
    "population": 2805
  },
  {
    "name": "Hill Top",
    "lat": -34.3525,
    "lon": 150.4917,
    "state": "New South Wales",
    "population": 2792
  },
  {
    "name": "Daylesford",
    "lat": -37.35,
    "lon": 144.15,
    "state": "Victoria",
    "population": 2781
  },
  {
    "name": "Woodside",
    "lat": -34.95,
    "lon": 138.883,
    "state": "South Australia",
    "population": 2701
  },
  {
    "name": "Freeling",
    "lat": -34.454,
    "lon": 138.81,
    "state": "South Australia",
    "population": 2688
  },
  {
    "name": "Lawson",
    "lat": -33.7178,
    "lon": 150.4322,
    "state": "New South Wales",
    "population": 2651
  },
  {
    "name": "Dodges Ferry",
    "lat": -42.8539,
    "lon": 147.6194,
    "state": "Tasmania",
    "population": 2646
  },
  {
    "name": "Aberdare",
    "lat": -32.8428,
    "lon": 151.3803,
    "state": "New South Wales",
    "population": 2542
  },
  {
    "name": "Launching Place",
    "lat": -37.7806,
    "lon": 145.5683,
    "state": "Victoria",
    "population": 2495
  },
  {
    "name": "Willunga",
    "lat": -35.2833,
    "lon": 138.55,
    "state": "South Australia",
    "population": 2445
  },
  {
    "name": "Hadspen",
    "lat": -41.5,
    "lon": 147.067,
    "state": "Tasmania",
    "population": 2429
  },
  {
    "name": "Holloway Beach",
    "lat": -16.8333,
    "lon": 145.7333,
    "state": "Queensland",
    "population": 2398
  },
  {
    "name": "Drummond Cove",
    "lat": -28.673,
    "lon": 114.613,
    "state": "Western Australia",
    "population": 2219
  },
  {
    "name": "South Golden Beach",
    "lat": -28.4978,
    "lon": 153.5469,
    "state": "New South Wales",
    "population": 2219
  },
  {
    "name": "Lyndoch",
    "lat": -34.601,
    "lon": 138.891,
    "state": "South Australia",
    "population": 2151
  },
  {
    "name": "Freshwater",
    "lat": -16.8833,
    "lon": 145.717,
    "state": "Queensland",
    "population": 2142
  },
  {
    "name": "Yarram",
    "lat": -38.55,
    "lon": 146.6667,
    "state": "Victoria",
    "population": 2136
  },
  {
    "name": "Wallerawang",
    "lat": -33.4067,
    "lon": 150.0678,
    "state": "New South Wales",
    "population": 2079
  },
  {
    "name": "Yaroomba",
    "lat": -26.55,
    "lon": 153.1,
    "state": "Queensland",
    "population": 2043
  },
  {
    "name": "Oakdale",
    "lat": -34.0817,
    "lon": 150.5011,
    "state": "New South Wales",
    "population": 2028
  },
  {
    "name": "Camden Haven",
    "lat": -31.6483,
    "lon": 152.8011,
    "state": "New South Wales",
    "population": 2012
  },
  {
    "name": "Wattleglen",
    "lat": -37.6667,
    "lon": 145.1833,
    "state": "Victoria",
    "population": 1961
  },
  {
    "name": "Mossman",
    "lat": -16.45,
    "lon": 145.3667,
    "state": "Queensland",
    "population": 1937
  },
  {
    "name": "Windsor",
    "lat": -33.6136,
    "lon": 150.8117,
    "state": "New South Wales",
    "population": 1915
  },
  {
    "name": "Batehaven",
    "lat": -35.7317,
    "lon": 150.2011,
    "state": "New South Wales",
    "population": 1911
  },
  {
    "name": "Bourke",
    "lat": -30.0817,
    "lon": 145.9511,
    "state": "New South Wales",
    "population": 1909
  },
  {
    "name": "Brunswick Heads",
    "lat": -28.5586,
    "lon": 153.5447,
    "state": "New South Wales",
    "population": 1905
  },
  {
    "name": "Mulwala",
    "lat": -35.9817,
    "lon": 146.0011,
    "state": "New South Wales",
    "population": 1904
  },
  {
    "name": "Woorim",
    "lat": -27.0677,
    "lon": 153.203,
    "state": "Queensland",
    "population": 1843
  },
  {
    "name": "Denman",
    "lat": -32.3817,
    "lon": 150.6844,
    "state": "New South Wales",
    "population": 1821
  },
  {
    "name": "Tathra",
    "lat": -36.7317,
    "lon": 149.9844,
    "state": "New South Wales",
    "population": 1675
  },
  {
    "name": "Yallourn North",
    "lat": -38.1667,
    "lon": 146.367,
    "state": "Victoria",
    "population": 1545
  },
  {
    "name": "Seven Mile Beach",
    "lat": -42.8586,
    "lon": 147.5053,
    "state": "Tasmania",
    "population": 1467
  },
  {
    "name": "Surfside",
    "lat": -35.695,
    "lon": 150.1997,
    "state": "New South Wales",
    "population": 1456
  },
  {
    "name": "Evandale",
    "lat": -41.5833,
    "lon": 147.2333,
    "state": "Tasmania",
    "population": 1345
  },
  {
    "name": "Fyansford",
    "lat": -38.1333,
    "lon": 144.3167,
    "state": "Victoria",
    "population": 1206
  },
  {
    "name": "Tinonee",
    "lat": -31.9483,
    "lon": 152.4178,
    "state": "New South Wales",
    "population": 1202
  },
  {
    "name": "Mollymook",
    "lat": -35.3372,
    "lon": 150.4667,
    "state": "New South Wales",
    "population": 1195
  },
  {
    "name": "Hope Vale",
    "lat": -15.297,
    "lon": 145.11,
    "state": "Queensland",
    "population": 1015
  }
];

export const AU_TOWN_COUNT = AU_TOWNS.length;

/** Rough km separation for declutter. */
function separationKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = (a.lat - b.lat) * 111;
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dLon = (a.lon - b.lon) * 111 * Math.cos(midLat);
  return Math.hypot(dLat, dLon);
}

export type TownDensity = {
  maxCount: number;
  minSeparationKm: number;
};

/**
 * Leaflet zoom breakpoints where town density steps up.
 * Starts below typical national fitBounds zoom (~3.5–4) so Map view
 * still shows the continental label set.
 */
export const LEAFLET_TOWN_ZOOM_BREAKS = [3.2, 4.2, 5.0, 5.8, 6.8, 7.8] as const;

/** Leaflet zoom → how many town labels to keep readable. */
export function townDensityForLeafletZoom(zoom: number): TownDensity {
  if (zoom < 3.2) return { maxCount: 0, minSeparationKm: 999 };
  if (zoom < 4.2) return { maxCount: 28, minSeparationKm: 280 };
  if (zoom < 5.0) return { maxCount: 55, minSeparationKm: 160 };
  if (zoom < 5.8) return { maxCount: 100, minSeparationKm: 90 };
  if (zoom < 6.8) return { maxCount: 160, minSeparationKm: 50 };
  if (zoom < 7.8) return { maxCount: 240, minSeparationKm: 28 };
  return { maxCount: 320, minSeparationKm: 14 };
}

/** Fixed satellite/region crop → density from geographic span. */
export function townDensityForBounds(
  bounds: [[number, number], [number, number]],
): TownDensity {
  const [[south, west], [north, east]] = bounds;
  const span = Math.max(Math.abs(east - west), Math.abs(north - south));
  if (span >= 40) return { maxCount: 28, minSeparationKm: 280 };
  if (span >= 20) return { maxCount: 55, minSeparationKm: 150 };
  if (span >= 10) return { maxCount: 110, minSeparationKm: 75 };
  if (span >= 5) return { maxCount: 180, minSeparationKm: 40 };
  return { maxCount: 260, minSeparationKm: 18 };
}

/** Prefer larger population, then keep spacing. */
export function declutterTowns<T extends { lat: number; lon: number; population?: number; name?: string }>(
  towns: readonly T[],
  density: TownDensity,
): T[] {
  if (density.maxCount <= 0) return [];
  const ranked = [...towns].sort(
    (a, b) =>
      (b.population ?? 0) - (a.population ?? 0) ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );
  const picked: T[] = [];
  for (const t of ranked) {
    if (picked.length >= density.maxCount) break;
    if (picked.every((p) => separationKm(p, t) >= density.minSeparationKm)) {
      picked.push(t);
    }
  }
  return picked;
}

function townKey(t: { name?: string; lat: number; lon: number }): string {
  return `${t.name ?? ""}|${t.lat}|${t.lon}`;
}

function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Zoom band progress for Google Earth–style label fade-in/out.
 * New towns in the current density band fade up as you zoom in,
 * and fade out again before the next coarser declutter drop.
 */
export function leafletTownZoomBand(zoom: number): {
  from: number;
  to: number;
  t: number;
} {
  const breaks = LEAFLET_TOWN_ZOOM_BREAKS;
  if (zoom < breaks[0]!) {
    return { from: breaks[0]!, to: breaks[1]!, t: 0 };
  }
  for (let i = 0; i < breaks.length - 1; i++) {
    const from = breaks[i]!;
    const to = breaks[i + 1]!;
    if (zoom < to) {
      return { from, to, t: (zoom - from) / (to - from) };
    }
  }
  const last = breaks[breaks.length - 1]!;
  return {
    from: last,
    to: last + 1.4,
    t: Math.min(1, (zoom - last) / 1.4),
  };
}

export type TownWithFade<T> = T & { labelOpacity: number };

/**
 * Declutter towns for the current Leaflet zoom and attach fade opacities
 * (established labels stay solid; newly admitted ones ease in).
 *
 * Fade completes early in each density band so national zoom (~4) stays
 * readable, while zooming still eases new towns in/out like Google Earth.
 */
export function declutterTownsWithFade<
  T extends { lat: number; lon: number; population?: number; name?: string },
>(towns: readonly T[], zoom: number): TownWithFade<T>[] {
  const current = declutterTowns(towns, townDensityForLeafletZoom(zoom));
  if (current.length === 0) return [];
  const band = leafletTownZoomBand(zoom);
  const previous = declutterTowns(
    towns,
    townDensityForLeafletZoom(Math.max(0, band.from - 0.001)),
  );
  const prevKeys = new Set(previous.map(townKey));
  // First density step (empty → national set): keep solid. Later steps fade.
  if (previous.length === 0) {
    return current.map((t) => ({ ...t, labelOpacity: 1 }));
  }
  // Reach full opacity by ~40% through the band so labels don't linger ghosted.
  const emerge = smoothstep01(Math.min(1, band.t / 0.4));
  const emergingOpacity = 0.22 + 0.78 * emerge;

  return current.map((t) => ({
    ...t,
    labelOpacity: prevKeys.has(townKey(t)) ? 1 : emergingOpacity,
  }));
}

/**
 * Population-rank fade for fixed satellite/region crops (no continuous zoom).
 * Capitals stay solid; smaller towns ease toward translucent (Google Earth–like).
 */
export function townOpacityByPopulationRank(
  population: number,
  visible: readonly { population?: number }[],
): number {
  if (visible.length <= 1) return 1;
  const pops = visible.map((t) => t.population ?? 0);
  const max = Math.max(...pops);
  const min = Math.min(...pops);
  if (max <= min) return 1;
  const rank = (population - min) / (max - min); // 0 = smallest, 1 = largest
  // Bias toward capitals (sqrt) so mid-size towns sit clearly between extremes.
  return 0.22 + 0.78 * smoothstep01(Math.sqrt(rank));
}
