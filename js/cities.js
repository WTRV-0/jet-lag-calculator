// Major world cities: [name, country, IANA time zone, airport codes, lat, lon]
const RAW = [
  // North America
  ['New York', 'United States', 'America/New_York', 'JFK EWR LGA NYC', 40.71, -74.01],
  ['Boston', 'United States', 'America/New_York', 'BOS', 42.36, -71.06],
  ['Washington, D.C.', 'United States', 'America/New_York', 'IAD DCA BWI', 38.91, -77.04],
  ['Philadelphia', 'United States', 'America/New_York', 'PHL', 39.95, -75.17],
  ['Miami', 'United States', 'America/New_York', 'MIA FLL', 25.76, -80.19],
  ['Orlando', 'United States', 'America/New_York', 'MCO', 28.54, -81.38],
  ['Tampa', 'United States', 'America/New_York', 'TPA', 27.95, -82.46],
  ['Atlanta', 'United States', 'America/New_York', 'ATL', 33.75, -84.39],
  ['Charlotte', 'United States', 'America/New_York', 'CLT', 35.23, -80.84],
  ['Raleigh', 'United States', 'America/New_York', 'RDU', 35.78, -78.64],
  ['Pittsburgh', 'United States', 'America/New_York', 'PIT', 40.44, -80.0],
  ['Detroit', 'United States', 'America/Detroit', 'DTW', 42.33, -83.05],
  ['Cleveland', 'United States', 'America/New_York', 'CLE', 41.5, -81.69],
  ['Columbus', 'United States', 'America/New_York', 'CMH', 39.96, -83.0],
  ['Indianapolis', 'United States', 'America/Indiana/Indianapolis', 'IND', 39.77, -86.16],
  ['Chicago', 'United States', 'America/Chicago', 'ORD MDW CHI', 41.88, -87.63],
  ['Minneapolis', 'United States', 'America/Chicago', 'MSP', 44.98, -93.27],
  ['St. Louis', 'United States', 'America/Chicago', 'STL', 38.63, -90.2],
  ['Kansas City', 'United States', 'America/Chicago', 'MCI', 39.1, -94.58],
  ['Nashville', 'United States', 'America/Chicago', 'BNA', 36.16, -86.78],
  ['New Orleans', 'United States', 'America/Chicago', 'MSY', 29.95, -90.07],
  ['Dallas', 'United States', 'America/Chicago', 'DFW DAL', 32.78, -96.8],
  ['Houston', 'United States', 'America/Chicago', 'IAH HOU', 29.76, -95.37],
  ['Austin', 'United States', 'America/Chicago', 'AUS', 30.27, -97.74],
  ['San Antonio', 'United States', 'America/Chicago', 'SAT', 29.42, -98.49],
  ['Milwaukee', 'United States', 'America/Chicago', 'MKE', 43.04, -87.91],
  ['Denver', 'United States', 'America/Denver', 'DEN', 39.74, -104.99],
  ['Salt Lake City', 'United States', 'America/Denver', 'SLC', 40.76, -111.89],
  ['Albuquerque', 'United States', 'America/Denver', 'ABQ', 35.08, -106.65],
  ['Phoenix', 'United States', 'America/Phoenix', 'PHX', 33.45, -112.07],
  ['Las Vegas', 'United States', 'America/Los_Angeles', 'LAS', 36.17, -115.14],
  ['Los Angeles', 'United States', 'America/Los_Angeles', 'LAX BUR LGB SNA', 34.05, -118.24],
  ['San Diego', 'United States', 'America/Los_Angeles', 'SAN', 32.72, -117.16],
  ['San Francisco', 'United States', 'America/Los_Angeles', 'SFO OAK SJC', 37.77, -122.42],
  ['Sacramento', 'United States', 'America/Los_Angeles', 'SMF', 38.58, -121.49],
  ['Portland', 'United States', 'America/Los_Angeles', 'PDX', 45.52, -122.68],
  ['Seattle', 'United States', 'America/Los_Angeles', 'SEA', 47.61, -122.33],
  ['Anchorage', 'United States', 'America/Anchorage', 'ANC', 61.22, -149.9],
  ['Honolulu', 'United States', 'Pacific/Honolulu', 'HNL', 21.31, -157.86],
  ['Maui (Kahului)', 'United States', 'Pacific/Honolulu', 'OGG', 20.89, -156.47],
  ['Toronto', 'Canada', 'America/Toronto', 'YYZ YTZ', 43.65, -79.38],
  ['Ottawa', 'Canada', 'America/Toronto', 'YOW', 45.42, -75.7],
  ['Montreal', 'Canada', 'America/Toronto', 'YUL', 45.5, -73.57],
  ['Quebec City', 'Canada', 'America/Toronto', 'YQB', 46.81, -71.21],
  ['Halifax', 'Canada', 'America/Halifax', 'YHZ', 44.65, -63.58],
  ["St. John's", 'Canada', 'America/St_Johns', 'YYT', 47.56, -52.71],
  ['Winnipeg', 'Canada', 'America/Winnipeg', 'YWG', 49.9, -97.14],
  ['Calgary', 'Canada', 'America/Edmonton', 'YYC', 51.05, -114.07],
  ['Edmonton', 'Canada', 'America/Edmonton', 'YEG', 53.55, -113.49],
  ['Vancouver', 'Canada', 'America/Vancouver', 'YVR', 49.28, -123.12],
  ['Mexico City', 'Mexico', 'America/Mexico_City', 'MEX', 19.43, -99.13],
  ['Guadalajara', 'Mexico', 'America/Mexico_City', 'GDL', 20.67, -103.35],
  ['Monterrey', 'Mexico', 'America/Monterrey', 'MTY', 25.69, -100.32],
  ['Cancún', 'Mexico', 'America/Cancun', 'CUN', 21.16, -86.85],
  ['Tijuana', 'Mexico', 'America/Tijuana', 'TIJ', 32.51, -117.04],
  ['Puerto Vallarta', 'Mexico', 'America/Bahia_Banderas', 'PVR', 20.65, -105.23],
  ['Cabo San Lucas', 'Mexico', 'America/Mazatlan', 'SJD', 22.89, -109.91],
  // Central America & Caribbean
  ['Guatemala City', 'Guatemala', 'America/Guatemala', 'GUA', 14.63, -90.51],
  ['San José', 'Costa Rica', 'America/Costa_Rica', 'SJO', 9.93, -84.08],
  ['Panama City', 'Panama', 'America/Panama', 'PTY', 8.98, -79.52],
  ['San Salvador', 'El Salvador', 'America/El_Salvador', 'SAL', 13.69, -89.22],
  ['Havana', 'Cuba', 'America/Havana', 'HAV', 23.11, -82.37],
  ['San Juan', 'Puerto Rico', 'America/Puerto_Rico', 'SJU', 18.47, -66.11],
  ['Santo Domingo', 'Dominican Republic', 'America/Santo_Domingo', 'SDQ', 18.49, -69.93],
  ['Punta Cana', 'Dominican Republic', 'America/Santo_Domingo', 'PUJ', 18.58, -68.4],
  ['Kingston', 'Jamaica', 'America/Jamaica', 'KIN', 17.97, -76.79],
  ['Montego Bay', 'Jamaica', 'America/Jamaica', 'MBJ', 18.47, -77.92],
  ['Nassau', 'Bahamas', 'America/Nassau', 'NAS', 25.05, -77.36],
  ['Bridgetown', 'Barbados', 'America/Barbados', 'BGI', 13.1, -59.61],
  ['Port of Spain', 'Trinidad and Tobago', 'America/Port_of_Spain', 'POS', 10.65, -61.52],
  ['Aruba (Oranjestad)', 'Aruba', 'America/Aruba', 'AUA', 12.52, -70.03],
  // South America
  ['Bogotá', 'Colombia', 'America/Bogota', 'BOG', 4.71, -74.07],
  ['Medellín', 'Colombia', 'America/Bogota', 'MDE', 6.24, -75.58],
  ['Cartagena', 'Colombia', 'America/Bogota', 'CTG', 10.39, -75.51],
  ['Caracas', 'Venezuela', 'America/Caracas', 'CCS', 10.48, -66.9],
  ['Quito', 'Ecuador', 'America/Guayaquil', 'UIO', -0.18, -78.47],
  ['Galápagos', 'Ecuador', 'Pacific/Galapagos', 'GPS', -0.74, -90.31],
  ['Lima', 'Peru', 'America/Lima', 'LIM', -12.05, -77.04],
  ['Cusco', 'Peru', 'America/Lima', 'CUZ', -13.53, -71.97],
  ['La Paz', 'Bolivia', 'America/La_Paz', 'LPB', -16.5, -68.15],
  ['Santiago', 'Chile', 'America/Santiago', 'SCL', -33.45, -70.67],
  ['Buenos Aires', 'Argentina', 'America/Argentina/Buenos_Aires', 'EZE AEP', -34.6, -58.38],
  ['Mendoza', 'Argentina', 'America/Argentina/Mendoza', 'MDZ', -32.89, -68.83],
  ['Montevideo', 'Uruguay', 'America/Montevideo', 'MVD', -34.9, -56.16],
  ['Asunción', 'Paraguay', 'America/Asuncion', 'ASU', -25.26, -57.58],
  ['São Paulo', 'Brazil', 'America/Sao_Paulo', 'GRU CGH', -23.55, -46.63],
  ['Rio de Janeiro', 'Brazil', 'America/Sao_Paulo', 'GIG SDU', -22.91, -43.17],
  ['Brasília', 'Brazil', 'America/Sao_Paulo', 'BSB', -15.79, -47.88],
  ['Salvador', 'Brazil', 'America/Bahia', 'SSA', -12.97, -38.5],
  ['Recife', 'Brazil', 'America/Recife', 'REC', -8.05, -34.88],
  ['Manaus', 'Brazil', 'America/Manaus', 'MAO', -3.12, -60.02],
  // Europe
  ['London', 'United Kingdom', 'Europe/London', 'LHR LGW STN LTN LCY LON', 51.51, -0.13],
  ['Manchester', 'United Kingdom', 'Europe/London', 'MAN', 53.48, -2.24],
  ['Edinburgh', 'United Kingdom', 'Europe/London', 'EDI', 55.95, -3.19],
  ['Glasgow', 'United Kingdom', 'Europe/London', 'GLA', 55.86, -4.25],
  ['Birmingham', 'United Kingdom', 'Europe/London', 'BHX', 52.49, -1.89],
  ['Dublin', 'Ireland', 'Europe/Dublin', 'DUB', 53.35, -6.26],
  ['Shannon', 'Ireland', 'Europe/Dublin', 'SNN', 52.7, -8.92],
  ['Reykjavík', 'Iceland', 'Atlantic/Reykjavik', 'KEF', 64.15, -21.94],
  ['Lisbon', 'Portugal', 'Europe/Lisbon', 'LIS', 38.72, -9.14],
  ['Porto', 'Portugal', 'Europe/Lisbon', 'OPO', 41.16, -8.63],
  ['Madeira (Funchal)', 'Portugal', 'Atlantic/Madeira', 'FNC', 32.65, -16.91],
  ['Azores (Ponta Delgada)', 'Portugal', 'Atlantic/Azores', 'PDL', 37.74, -25.67],
  ['Madrid', 'Spain', 'Europe/Madrid', 'MAD', 40.42, -3.7],
  ['Barcelona', 'Spain', 'Europe/Madrid', 'BCN', 41.39, 2.17],
  ['Seville', 'Spain', 'Europe/Madrid', 'SVQ', 37.39, -5.98],
  ['Málaga', 'Spain', 'Europe/Madrid', 'AGP', 36.72, -4.42],
  ['Palma de Mallorca', 'Spain', 'Europe/Madrid', 'PMI', 39.57, 2.65],
  ['Canary Islands (Las Palmas)', 'Spain', 'Atlantic/Canary', 'LPA TFS', 28.12, -15.43],
  ['Paris', 'France', 'Europe/Paris', 'CDG ORY PAR', 48.86, 2.35],
  ['Nice', 'France', 'Europe/Paris', 'NCE', 43.71, 7.26],
  ['Lyon', 'France', 'Europe/Paris', 'LYS', 45.76, 4.84],
  ['Marseille', 'France', 'Europe/Paris', 'MRS', 43.3, 5.37],
  ['Brussels', 'Belgium', 'Europe/Brussels', 'BRU', 50.85, 4.35],
  ['Amsterdam', 'Netherlands', 'Europe/Amsterdam', 'AMS', 52.37, 4.9],
  ['Luxembourg', 'Luxembourg', 'Europe/Luxembourg', 'LUX', 49.61, 6.13],
  ['Frankfurt', 'Germany', 'Europe/Berlin', 'FRA', 50.11, 8.68],
  ['Berlin', 'Germany', 'Europe/Berlin', 'BER', 52.52, 13.4],
  ['Munich', 'Germany', 'Europe/Berlin', 'MUC', 48.14, 11.58],
  ['Hamburg', 'Germany', 'Europe/Berlin', 'HAM', 53.55, 9.99],
  ['Düsseldorf', 'Germany', 'Europe/Berlin', 'DUS', 51.23, 6.78],
  ['Cologne', 'Germany', 'Europe/Berlin', 'CGN', 50.94, 6.96],
  ['Zurich', 'Switzerland', 'Europe/Zurich', 'ZRH', 47.38, 8.54],
  ['Geneva', 'Switzerland', 'Europe/Zurich', 'GVA', 46.2, 6.14],
  ['Vienna', 'Austria', 'Europe/Vienna', 'VIE', 48.21, 16.37],
  ['Salzburg', 'Austria', 'Europe/Vienna', 'SZG', 47.81, 13.06],
  ['Rome', 'Italy', 'Europe/Rome', 'FCO CIA', 41.9, 12.5],
  ['Milan', 'Italy', 'Europe/Rome', 'MXP LIN', 45.46, 9.19],
  ['Venice', 'Italy', 'Europe/Rome', 'VCE', 45.44, 12.32],
  ['Florence', 'Italy', 'Europe/Rome', 'FLR', 43.77, 11.26],
  ['Naples', 'Italy', 'Europe/Rome', 'NAP', 40.85, 14.27],
  ['Palermo', 'Italy', 'Europe/Rome', 'PMO', 38.12, 13.36],
  ['Valletta', 'Malta', 'Europe/Malta', 'MLA', 35.9, 14.51],
  ['Copenhagen', 'Denmark', 'Europe/Copenhagen', 'CPH', 55.68, 12.57],
  ['Oslo', 'Norway', 'Europe/Oslo', 'OSL', 59.91, 10.75],
  ['Bergen', 'Norway', 'Europe/Oslo', 'BGO', 60.39, 5.32],
  ['Tromsø', 'Norway', 'Europe/Oslo', 'TOS', 69.65, 18.96],
  ['Stockholm', 'Sweden', 'Europe/Stockholm', 'ARN', 59.33, 18.07],
  ['Gothenburg', 'Sweden', 'Europe/Stockholm', 'GOT', 57.71, 11.97],
  ['Helsinki', 'Finland', 'Europe/Helsinki', 'HEL', 60.17, 24.94],
  ['Tallinn', 'Estonia', 'Europe/Tallinn', 'TLL', 59.44, 24.75],
  ['Riga', 'Latvia', 'Europe/Riga', 'RIX', 56.95, 24.11],
  ['Vilnius', 'Lithuania', 'Europe/Vilnius', 'VNO', 54.69, 25.28],
  ['Warsaw', 'Poland', 'Europe/Warsaw', 'WAW', 52.23, 21.01],
  ['Kraków', 'Poland', 'Europe/Warsaw', 'KRK', 50.06, 19.94],
  ['Prague', 'Czechia', 'Europe/Prague', 'PRG', 50.08, 14.44],
  ['Budapest', 'Hungary', 'Europe/Budapest', 'BUD', 47.5, 19.04],
  ['Bratislava', 'Slovakia', 'Europe/Bratislava', 'BTS', 48.15, 17.11],
  ['Ljubljana', 'Slovenia', 'Europe/Ljubljana', 'LJU', 46.06, 14.51],
  ['Zagreb', 'Croatia', 'Europe/Zagreb', 'ZAG', 45.81, 15.98],
  ['Split', 'Croatia', 'Europe/Zagreb', 'SPU', 43.51, 16.44],
  ['Dubrovnik', 'Croatia', 'Europe/Zagreb', 'DBV', 42.65, 18.09],
  ['Belgrade', 'Serbia', 'Europe/Belgrade', 'BEG', 44.79, 20.45],
  ['Sarajevo', 'Bosnia and Herzegovina', 'Europe/Sarajevo', 'SJJ', 43.86, 18.41],
  ['Bucharest', 'Romania', 'Europe/Bucharest', 'OTP', 44.43, 26.1],
  ['Sofia', 'Bulgaria', 'Europe/Sofia', 'SOF', 42.7, 23.32],
  ['Athens', 'Greece', 'Europe/Athens', 'ATH', 37.98, 23.73],
  ['Thessaloniki', 'Greece', 'Europe/Athens', 'SKG', 40.64, 22.94],
  ['Santorini', 'Greece', 'Europe/Athens', 'JTR', 36.39, 25.46],
  ['Nicosia', 'Cyprus', 'Asia/Nicosia', 'LCA PFO', 35.19, 33.38],
  ['Istanbul', 'Türkiye', 'Europe/Istanbul', 'IST SAW', 41.01, 28.98],
  ['Antalya', 'Türkiye', 'Europe/Istanbul', 'AYT', 36.9, 30.71],
  ['Ankara', 'Türkiye', 'Europe/Istanbul', 'ESB', 39.93, 32.86],
  ['Kyiv', 'Ukraine', 'Europe/Kyiv', 'KBP', 50.45, 30.52],
  ['Chișinău', 'Moldova', 'Europe/Chisinau', 'KIV', 47.01, 28.86],
  ['Minsk', 'Belarus', 'Europe/Minsk', 'MSQ', 53.9, 27.56],
  ['Moscow', 'Russia', 'Europe/Moscow', 'SVO DME VKO', 55.76, 37.62],
  ['St. Petersburg', 'Russia', 'Europe/Moscow', 'LED', 59.93, 30.34],
  ['Tbilisi', 'Georgia', 'Asia/Tbilisi', 'TBS', 41.72, 44.79],
  ['Yerevan', 'Armenia', 'Asia/Yerevan', 'EVN', 40.18, 44.51],
  ['Baku', 'Azerbaijan', 'Asia/Baku', 'GYD', 40.41, 49.87],
  // Middle East
  ['Dubai', 'United Arab Emirates', 'Asia/Dubai', 'DXB DWC', 25.2, 55.27],
  ['Abu Dhabi', 'United Arab Emirates', 'Asia/Dubai', 'AUH', 24.45, 54.38],
  ['Doha', 'Qatar', 'Asia/Qatar', 'DOH', 25.29, 51.53],
  ['Manama', 'Bahrain', 'Asia/Bahrain', 'BAH', 26.23, 50.59],
  ['Kuwait City', 'Kuwait', 'Asia/Kuwait', 'KWI', 29.38, 47.99],
  ['Riyadh', 'Saudi Arabia', 'Asia/Riyadh', 'RUH', 24.71, 46.68],
  ['Jeddah', 'Saudi Arabia', 'Asia/Riyadh', 'JED', 21.49, 39.19],
  ['Muscat', 'Oman', 'Asia/Muscat', 'MCT', 23.59, 58.41],
  ['Tel Aviv', 'Israel', 'Asia/Jerusalem', 'TLV', 32.09, 34.78],
  ['Jerusalem', 'Israel', 'Asia/Jerusalem', '', 31.77, 35.21],
  ['Amman', 'Jordan', 'Asia/Amman', 'AMM', 31.95, 35.93],
  ['Beirut', 'Lebanon', 'Asia/Beirut', 'BEY', 33.89, 35.5],
  ['Tehran', 'Iran', 'Asia/Tehran', 'IKA THR', 35.69, 51.39],
  ['Baghdad', 'Iraq', 'Asia/Baghdad', 'BGW', 33.31, 44.36],
  // Africa
  ['Cairo', 'Egypt', 'Africa/Cairo', 'CAI', 30.04, 31.24],
  ['Sharm El Sheikh', 'Egypt', 'Africa/Cairo', 'SSH', 27.92, 34.33],
  ['Casablanca', 'Morocco', 'Africa/Casablanca', 'CMN', 33.57, -7.59],
  ['Marrakesh', 'Morocco', 'Africa/Casablanca', 'RAK', 31.63, -7.99],
  ['Tunis', 'Tunisia', 'Africa/Tunis', 'TUN', 36.81, 10.18],
  ['Algiers', 'Algeria', 'Africa/Algiers', 'ALG', 36.75, 3.06],
  ['Lagos', 'Nigeria', 'Africa/Lagos', 'LOS', 6.52, 3.38],
  ['Abuja', 'Nigeria', 'Africa/Lagos', 'ABV', 9.08, 7.4],
  ['Accra', 'Ghana', 'Africa/Accra', 'ACC', 5.6, -0.19],
  ['Dakar', 'Senegal', 'Africa/Dakar', 'DSS', 14.72, -17.47],
  ['Abidjan', "Côte d'Ivoire", 'Africa/Abidjan', 'ABJ', 5.36, -4.01],
  ['Addis Ababa', 'Ethiopia', 'Africa/Addis_Ababa', 'ADD', 9.03, 38.74],
  ['Nairobi', 'Kenya', 'Africa/Nairobi', 'NBO', -1.29, 36.82],
  ['Mombasa', 'Kenya', 'Africa/Nairobi', 'MBA', -4.04, 39.67],
  ['Kigali', 'Rwanda', 'Africa/Kigali', 'KGL', -1.94, 30.06],
  ['Kampala', 'Uganda', 'Africa/Kampala', 'EBB', 0.35, 32.58],
  ['Dar es Salaam', 'Tanzania', 'Africa/Dar_es_Salaam', 'DAR', -6.79, 39.21],
  ['Zanzibar', 'Tanzania', 'Africa/Dar_es_Salaam', 'ZNZ', -6.17, 39.2],
  ['Kilimanjaro (Arusha)', 'Tanzania', 'Africa/Dar_es_Salaam', 'JRO', -3.39, 36.68],
  ['Johannesburg', 'South Africa', 'Africa/Johannesburg', 'JNB', -26.2, 28.05],
  ['Cape Town', 'South Africa', 'Africa/Johannesburg', 'CPT', -33.92, 18.42],
  ['Durban', 'South Africa', 'Africa/Johannesburg', 'DUR', -29.86, 31.02],
  ['Windhoek', 'Namibia', 'Africa/Windhoek', 'WDH', -22.56, 17.08],
  ['Victoria Falls', 'Zimbabwe', 'Africa/Harare', 'VFA', -17.93, 25.83],
  ['Lusaka', 'Zambia', 'Africa/Lusaka', 'LUN', -15.39, 28.32],
  ['Gaborone', 'Botswana', 'Africa/Gaborone', 'GBE', -24.65, 25.91],
  ['Luanda', 'Angola', 'Africa/Luanda', 'LAD', -8.84, 13.23],
  ['Kinshasa', 'DR Congo', 'Africa/Kinshasa', 'FIH', -4.44, 15.27],
  ['Antananarivo', 'Madagascar', 'Indian/Antananarivo', 'TNR', -18.88, 47.51],
  ['Port Louis', 'Mauritius', 'Indian/Mauritius', 'MRU', -20.16, 57.5],
  ['Mahé (Victoria)', 'Seychelles', 'Indian/Mahe', 'SEZ', -4.62, 55.45],
  // South & Central Asia
  ['Delhi', 'India', 'Asia/Kolkata', 'DEL', 28.61, 77.21],
  ['Mumbai', 'India', 'Asia/Kolkata', 'BOM', 19.08, 72.88],
  ['Bengaluru', 'India', 'Asia/Kolkata', 'BLR', 12.97, 77.59],
  ['Chennai', 'India', 'Asia/Kolkata', 'MAA', 13.08, 80.27],
  ['Kolkata', 'India', 'Asia/Kolkata', 'CCU', 22.57, 88.36],
  ['Hyderabad', 'India', 'Asia/Kolkata', 'HYD', 17.39, 78.49],
  ['Goa', 'India', 'Asia/Kolkata', 'GOI GOX', 15.38, 73.83],
  ['Kochi', 'India', 'Asia/Kolkata', 'COK', 9.93, 76.27],
  ['Karachi', 'Pakistan', 'Asia/Karachi', 'KHI', 24.86, 67.0],
  ['Lahore', 'Pakistan', 'Asia/Karachi', 'LHE', 31.55, 74.34],
  ['Islamabad', 'Pakistan', 'Asia/Karachi', 'ISB', 33.68, 73.05],
  ['Dhaka', 'Bangladesh', 'Asia/Dhaka', 'DAC', 23.81, 90.41],
  ['Kathmandu', 'Nepal', 'Asia/Kathmandu', 'KTM', 27.72, 85.32],
  ['Thimphu (Paro)', 'Bhutan', 'Asia/Thimphu', 'PBH', 27.47, 89.64],
  ['Colombo', 'Sri Lanka', 'Asia/Colombo', 'CMB', 6.93, 79.86],
  ['Malé', 'Maldives', 'Indian/Maldives', 'MLE', 4.18, 73.51],
  ['Kabul', 'Afghanistan', 'Asia/Kabul', 'KBL', 34.56, 69.21],
  ['Tashkent', 'Uzbekistan', 'Asia/Tashkent', 'TAS', 41.3, 69.24],
  ['Samarkand', 'Uzbekistan', 'Asia/Samarkand', 'SKD', 39.65, 66.96],
  ['Almaty', 'Kazakhstan', 'Asia/Almaty', 'ALA', 43.24, 76.89],
  ['Astana', 'Kazakhstan', 'Asia/Almaty', 'NQZ', 51.17, 71.45],
  ['Bishkek', 'Kyrgyzstan', 'Asia/Bishkek', 'FRU', 42.87, 74.59],
  // East & Southeast Asia
  ['Tokyo', 'Japan', 'Asia/Tokyo', 'HND NRT TYO', 35.68, 139.69],
  ['Osaka', 'Japan', 'Asia/Tokyo', 'KIX ITM', 34.69, 135.5],
  ['Kyoto', 'Japan', 'Asia/Tokyo', '', 35.01, 135.77],
  ['Sapporo', 'Japan', 'Asia/Tokyo', 'CTS', 43.06, 141.35],
  ['Fukuoka', 'Japan', 'Asia/Tokyo', 'FUK', 33.59, 130.4],
  ['Okinawa (Naha)', 'Japan', 'Asia/Tokyo', 'OKA', 26.21, 127.68],
  ['Seoul', 'South Korea', 'Asia/Seoul', 'ICN GMP SEL', 37.57, 126.98],
  ['Busan', 'South Korea', 'Asia/Seoul', 'PUS', 35.18, 129.08],
  ['Jeju', 'South Korea', 'Asia/Seoul', 'CJU', 33.5, 126.53],
  ['Beijing', 'China', 'Asia/Shanghai', 'PEK PKX', 39.9, 116.41],
  ['Shanghai', 'China', 'Asia/Shanghai', 'PVG SHA', 31.23, 121.47],
  ['Guangzhou', 'China', 'Asia/Shanghai', 'CAN', 23.13, 113.26],
  ['Shenzhen', 'China', 'Asia/Shanghai', 'SZX', 22.54, 114.06],
  ['Chengdu', 'China', 'Asia/Shanghai', 'CTU TFU', 30.57, 104.07],
  ['Chongqing', 'China', 'Asia/Shanghai', 'CKG', 29.56, 106.55],
  ["Xi'an", 'China', 'Asia/Shanghai', 'XIY', 34.34, 108.94],
  ['Hangzhou', 'China', 'Asia/Shanghai', 'HGH', 30.27, 120.16],
  ['Hong Kong', 'China', 'Asia/Hong_Kong', 'HKG', 22.32, 114.17],
  ['Macau', 'China', 'Asia/Macau', 'MFM', 22.2, 113.54],
  ['Taipei', 'Taiwan', 'Asia/Taipei', 'TPE TSA', 25.03, 121.57],
  ['Ulaanbaatar', 'Mongolia', 'Asia/Ulaanbaatar', 'UBN', 47.89, 106.91],
  ['Manila', 'Philippines', 'Asia/Manila', 'MNL', 14.6, 120.98],
  ['Cebu', 'Philippines', 'Asia/Manila', 'CEB', 10.32, 123.89],
  ['Bangkok', 'Thailand', 'Asia/Bangkok', 'BKK DMK', 13.76, 100.5],
  ['Phuket', 'Thailand', 'Asia/Bangkok', 'HKT', 7.88, 98.39],
  ['Chiang Mai', 'Thailand', 'Asia/Bangkok', 'CNX', 18.79, 98.98],
  ['Hanoi', 'Vietnam', 'Asia/Ho_Chi_Minh', 'HAN', 21.03, 105.85],
  ['Ho Chi Minh City', 'Vietnam', 'Asia/Ho_Chi_Minh', 'SGN', 10.82, 106.63],
  ['Da Nang', 'Vietnam', 'Asia/Ho_Chi_Minh', 'DAD', 16.05, 108.2],
  ['Phnom Penh', 'Cambodia', 'Asia/Phnom_Penh', 'PNH', 11.56, 104.93],
  ['Siem Reap', 'Cambodia', 'Asia/Phnom_Penh', 'SAI', 13.36, 103.86],
  ['Vientiane', 'Laos', 'Asia/Vientiane', 'VTE', 17.98, 102.63],
  ['Yangon', 'Myanmar', 'Asia/Yangon', 'RGN', 16.87, 96.2],
  ['Kuala Lumpur', 'Malaysia', 'Asia/Kuala_Lumpur', 'KUL', 3.14, 101.69],
  ['Penang', 'Malaysia', 'Asia/Kuala_Lumpur', 'PEN', 5.41, 100.33],
  ['Kota Kinabalu', 'Malaysia', 'Asia/Kuching', 'BKI', 5.98, 116.07],
  ['Singapore', 'Singapore', 'Asia/Singapore', 'SIN', 1.35, 103.82],
  ['Jakarta', 'Indonesia', 'Asia/Jakarta', 'CGK', -6.21, 106.85],
  ['Bali (Denpasar)', 'Indonesia', 'Asia/Makassar', 'DPS', -8.65, 115.22],
  ['Bandar Seri Begawan', 'Brunei', 'Asia/Brunei', 'BWN', 4.9, 114.94],
  // Oceania
  ['Sydney', 'Australia', 'Australia/Sydney', 'SYD', -33.87, 151.21],
  ['Melbourne', 'Australia', 'Australia/Melbourne', 'MEL', -37.81, 144.96],
  ['Brisbane', 'Australia', 'Australia/Brisbane', 'BNE', -27.47, 153.03],
  ['Gold Coast', 'Australia', 'Australia/Brisbane', 'OOL', -28.02, 153.4],
  ['Cairns', 'Australia', 'Australia/Brisbane', 'CNS', -16.92, 145.77],
  ['Canberra', 'Australia', 'Australia/Sydney', 'CBR', -35.28, 149.13],
  ['Adelaide', 'Australia', 'Australia/Adelaide', 'ADL', -34.93, 138.6],
  ['Perth', 'Australia', 'Australia/Perth', 'PER', -31.95, 115.86],
  ['Darwin', 'Australia', 'Australia/Darwin', 'DRW', -12.46, 130.84],
  ['Hobart', 'Australia', 'Australia/Hobart', 'HBA', -42.88, 147.33],
  ['Auckland', 'New Zealand', 'Pacific/Auckland', 'AKL', -36.85, 174.76],
  ['Wellington', 'New Zealand', 'Pacific/Auckland', 'WLG', -41.29, 174.78],
  ['Christchurch', 'New Zealand', 'Pacific/Auckland', 'CHC', -43.53, 172.64],
  ['Queenstown', 'New Zealand', 'Pacific/Auckland', 'ZQN', -45.03, 168.66],
  ['Nadi', 'Fiji', 'Pacific/Fiji', 'NAN', -17.78, 177.44],
  ['Papeete (Tahiti)', 'French Polynesia', 'Pacific/Tahiti', 'PPT', -17.54, -149.57],
  ['Nouméa', 'New Caledonia', 'Pacific/Noumea', 'NOU', -22.28, 166.46],
  ['Port Moresby', 'Papua New Guinea', 'Pacific/Port_Moresby', 'POM', -9.44, 147.18],
  ['Apia', 'Samoa', 'Pacific/Apia', 'APW', -13.83, -171.77],
  ["Nuku'alofa", 'Tonga', 'Pacific/Tongatapu', 'TBU', -21.14, -175.2],
  ['Rarotonga', 'Cook Islands', 'Pacific/Rarotonga', 'RAR', -21.21, -159.78],
  ['Guam (Hagåtña)', 'Guam', 'Pacific/Guam', 'GUM', 13.47, 144.75],
];

function slug(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export const CITIES = RAW.map(([name, country, tz, codes, lat, lon]) => ({
  id: slug(name + '-' + country),
  name, country, tz, lat, lon,
  codes: codes ? codes.split(' ') : [],
}));

const BY_ID = new Map(CITIES.map((c) => [c.id, c]));

export function cityById(id) {
  return BY_ID.get(id) || null;
}

// A bare IANA zone (no coordinates) chosen from the full list
export function zonePlace(tz) {
  const city = tz.split('/').pop().replace(/_/g, ' ');
  return { id: 'tz:' + tz, name: city, country: tz, tz, lat: null, lon: null, codes: [] };
}

export function placeById(id) {
  if (!id) return null;
  if (id.startsWith('tz:')) return zonePlace(id.slice(3));
  return cityById(id);
}

function fold(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

let zoneList = null;
function allZones() {
  if (!zoneList) {
    try { zoneList = Intl.supportedValuesOf('timeZone'); } catch { zoneList = []; }
  }
  return zoneList;
}

// Ranked search over cities, airport codes, countries, then raw IANA zones
export function searchPlaces(query, limit = 8) {
  const q = fold(query.trim());
  if (!q) return [];
  const scored = [];
  for (const c of CITIES) {
    const name = fold(c.name);
    const country = fold(c.country);
    let score = 0;
    if (c.codes.some((code) => code.toLowerCase() === q)) score = 100;
    else if (name === q) score = 95;
    else if (name.startsWith(q)) score = 80;
    else if (name.split(/[\s(,.-]+/).some((w) => w.startsWith(q))) score = 65;
    else if (country.startsWith(q)) score = 40;
    else if (name.includes(q)) score = 30;
    else if (fold(c.tz).includes(q.replace(/\s+/g, '_'))) score = 20;
    if (score) scored.push([score, c]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
  const out = scored.slice(0, limit).map((s) => s[1]);
  if (out.length < limit && q.length >= 3) {
    const needle = q.replace(/\s+/g, '_');
    const known = new Set(CITIES.map((c) => c.tz));
    for (const tz of allZones()) {
      if (out.length >= limit) break;
      if (fold(tz).includes(needle) && !known.has(tz)) out.push(zonePlace(tz));
    }
  }
  return out;
}

// Best guess at the visitor's home city from the browser's zone
export function guessHome() {
  let tz = null;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* ignore */ }
  if (!tz) return null;
  return CITIES.find((c) => c.tz === tz) || zonePlace(tz);
}
