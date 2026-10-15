/* Sanga map helper. The ONLY file that knows which map service is used (OpenStreetMap + Leaflet).
   To move to Google Maps later, replace what is inside this file; pages only call SanghaMap.* and
   events only store { exactAddress, lat, lng }. */
(function(){
  const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  let loading = null;

  function loadLeaflet(){
    if(window.L) return Promise.resolve(window.L);
    if(loading) return loading;
    loading = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET_CSS;
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = LEAFLET_JS;
      s.onload = () => resolve(window.L);
      s.onerror = () => { loading = null; reject(new Error('Map could not load')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function validPoint(lat, lng){
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  }

  // City, state and country out of a map answer's address details ('' for any that is missing)
  function partsOf(a){
    a = a || {};
    return {
      city: a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || '',
      state: a.state || a.region || a.province || a.state_district || '',
      country: a.country || ''
    };
  }

  // Place search for the City box: only cities, towns and villages (never street addresses).
  // Returns [{ label: 'City, State, Country', city, state, country, lat, lng }]
  const CITY_TYPES = ['city', 'town', 'village', 'hamlet', 'municipality', 'suburb', 'borough', 'city_district', 'locality'];
  async function places(query){
    const q = String(query || '').trim();
    if(q.length < 2) return [];
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=10&dedupe=1&addressdetails=1&featuretype=city&q=' + encodeURIComponent(q));
    if(!res.ok) throw new Error('Search failed');
    const rows = await res.json();
    const seen = {};
    return rows
      .filter((r) => !r.addresstype || CITY_TYPES.indexOf(r.addresstype) !== -1)
      .map((r) => { const p = partsOf(r.address); return Object.assign({ lat: parseFloat(r.lat), lng: parseFloat(r.lon) }, p, { label: [p.city, p.state, p.country].filter(Boolean).join(', ') }); })
      .filter((r) => r.city && validPoint(r.lat, r.lng) && !seen[r.label] && (seen[r.label] = true))
      .slice(0, 6);
  }

  // Address search: returns [{ label, lat, lng, city, state, country }].
  // `near` ('City, State, Country' already entered) keeps the search to that place.
  async function search(query, near){
    const q = String(query || '').trim();
    if(q.length < 3) return [];
    const full = near ? q + ', ' + near : q;
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=8&addressdetails=1&q=' + encodeURIComponent(full));
    if(!res.ok) throw new Error('Search failed');
    const rows = await res.json();
    let list = rows.map(r => Object.assign({ label: r.display_name, lat: parseFloat(r.lat), lng: parseFloat(r.lon) }, partsOf(r.address))).filter(r => validPoint(r.lat, r.lng));
    if(near){
      // keep results that are in the entered state and country (if that leaves nothing, show them all rather than nothing)
      const bits = String(near).split(',').slice(1).map((x) => x.trim().toLowerCase()).filter(Boolean);
      const inside = list.filter((r) => bits.every((b) => r.label.toLowerCase().indexOf(b) !== -1 || [r.state, r.country].some((v) => String(v).toLowerCase() === b)));
      if(inside.length) list = inside;
    }
    return list.slice(0, 5);
  }

  // Coordinates to an address name ('' if it cannot be looked up)
  async function reverse(lat, lng){
    try{
      const res = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng);
      if(!res.ok) return '';
      const d = await res.json();
      return d.display_name || '';
    }catch(e){ return ''; }
  }

  // Same as reverse() but also gives the city, state and country: { label, city, state, country }
  async function reverseParts(lat, lng){
    try{
      const res = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=' + lat + '&lon=' + lng);
      if(!res.ok) return { label: '', city: '', state: '', country: '' };
      const d = await res.json();
      return Object.assign({ label: d.display_name || '' }, partsOf(d.address));
    }catch(e){ return { label: '', city: '', state: '', country: '' }; }
  }

  // Time zone of a point on the map, e.g. 'America/Los_Angeles' (a small lookup table, loaded the first time it is needed)
  let tzLoading = null;
  function loadTz(){
    if(window.tzlookup) return Promise.resolve(window.tzlookup);
    if(tzLoading) return tzLoading;
    tzLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tz-lookup@6.1.25/tz.js';
      s.onload = () => resolve(window.tzlookup);
      s.onerror = () => { tzLoading = null; reject(new Error('Time zone lookup could not load')); };
      document.head.appendChild(s);
    });
    return tzLoading;
  }
  async function timezoneOf(lat, lng){
    const f = await loadTz();
    return f(lat, lng);
  }
  // 'America/Los_Angeles' -> 'Pacific Time (America/Los_Angeles)'
  function zoneLabel(iana){
    if(!iana) return '';
    try{
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: iana, timeZoneName: 'longGeneric' }).formatToParts(new Date());
      const n = parts.find((x) => x.type === 'timeZoneName');
      return (n ? n.value : iana) + ' (' + iana + ')';
    }catch(e){ return iana; }
  }

  // Draws a map in `el`. opts: { lat, lng, pickable, onPick(lat, lng) }. Returns { setPoint, clear, refresh }.
  async function mount(el, opts){
    opts = opts || {};
    const L = await loadLeaflet();
    const has = validPoint(opts.lat, opts.lng);
    const map = L.map(el, { scrollWheelZoom: false }).setView(has ? [opts.lat, opts.lng] : [20, 0], has ? 15 : 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    let marker = null;

    function put(lat, lng, zoom){
      if(marker){ marker.setLatLng([lat, lng]); }
      else {
        marker = L.marker([lat, lng], { draggable: !!opts.pickable }).addTo(map);
        if(opts.pickable) marker.on('dragend', () => { const p = marker.getLatLng(); if(opts.onPick) opts.onPick(p.lat, p.lng); });
      }
      if(zoom) map.setView([lat, lng], zoom);
    }
    if(has) put(opts.lat, opts.lng);
    if(opts.pickable) map.on('click', (e) => { put(e.latlng.lat, e.latlng.lng); if(opts.onPick) opts.onPick(e.latlng.lat, e.latlng.lng); });

    return {
      setPoint(lat, lng){ if(validPoint(lat, lng)) put(lat, lng, 16); },
      clear(){ if(marker){ map.removeLayer(marker); marker = null; } },
      refresh(){ map.invalidateSize(); }
    };
  }

  // "Open in" links for a point
  function links(lat, lng, label){
    const ll = lat + ',' + lng;
    return {
      google: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ll),
      apple: 'https://maps.apple.com/?ll=' + encodeURIComponent(ll) + '&q=' + encodeURIComponent(label || 'Meeting point')
    };
  }

  // Named places people use to say where they live: neighborhoods, parks, community places and shopping centers inside a city.
  // One request finds the city's box, a second lists what is in it (OpenStreetMap, free); the answer is kept for a day.
  const LANDMARK_GROUPS = [
    ['Neighborhoods', 'neighborhood'],
    ['Parks', 'park'],
    ['Community places', 'community'],
    ['Shopping centers', 'shopping']
  ];
  function landmarkKind(tags){
    if(/^(neighbourhood|suburb|quarter)$/.test(tags.place || '')) return 'neighborhood';
    if(tags.leisure === 'park') return 'park';
    if(tags.amenity === 'community_centre' || tags.amenity === 'library') return 'community';
    if(tags.shop === 'mall' || tags.landuse === 'retail') return 'shopping';
    return '';
  }
  async function landmarks(city, state, country){
    const where = [city, state, country].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
    if(!city || !String(city).trim()) return [];
    const key = 'sangha_landmarks2_' + where.toLowerCase();
    try{
      const hit = JSON.parse(localStorage.getItem(key) || 'null');
      if(hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.rows;
    }catch(e){}
    // ask for the city by name, state and country (a plain text search can land on another "Dublin")
    const geoUrl = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&city=' + encodeURIComponent(String(city).trim()) +
      (state ? '&state=' + encodeURIComponent(String(state).trim()) : '') + (country ? '&country=' + encodeURIComponent(String(country).trim()) : '');
    let geo = await (await fetch(geoUrl)).json();
    if(!geo || !geo[0]) geo = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(where))).json();
    if(!geo || !geo[0]) return [];
    const cLat = parseFloat(geo[0].lat), cLng = parseFloat(geo[0].lon);
    // inside the city's own boundary when the map has one (no neighboring towns, and a big city is not cut off);
    // otherwise everything within 5 km of the middle of the city
    const area = geo[0].osm_type === 'relation' ? 'area(' + (3600000000 + Number(geo[0].osm_id)) + ')->.a;' : '';
    const place = area ? '(area.a)' : '(around:5000,' + cLat + ',' + cLng + ')';
    const ql = '[out:json][timeout:50];' + area + '(' +
      'nwr["leisure"="park"]["name"]' + place + ';' +
      'nwr["amenity"~"^(community_centre|library)$"]["name"]' + place + ';' +
      'nwr["shop"="mall"]["name"]' + place + ';' +
      'nwr["landuse"="retail"]["name"]' + place + ';' +
      'nwr["place"~"^(neighbourhood|suburb|quarter)$"]["name"]' + place + ';' +
      ');out center tags 3000;';
    // the main Overpass server is sometimes busy; a second one answers the same question
    let data = null, lastErr = null;
    for(const server of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']){
      try{
        const res = await fetch(server, { method: 'POST', body: 'data=' + encodeURIComponent(ql), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if(!res.ok) throw new Error('Landmark lookup failed (' + res.status + ')');
        data = await res.json();
        break;
      }catch(e){ lastErr = e; }
    }
    if(!data) throw lastErr || new Error('Landmark lookup failed');
    const seen = {}, byKind = {};
    (data.elements || []).forEach((el) => {
      const tags = el.tags || {}, name = String(tags.name || '').trim(), kind = landmarkKind(tags);
      if(!name || !kind || seen[kind + '|' + name.toLowerCase()]) return;
      seen[kind + '|' + name.toLowerCase()] = 1;
      const lat = el.lat != null ? el.lat : (el.center && el.center.lat), lng = el.lon != null ? el.lon : (el.center && el.center.lon);
      const d = (lat == null || lng == null) ? 1e9 : Math.hypot(lat - cLat, (lng - cLng) * Math.cos(cLat * Math.PI / 180));
      (byKind[kind] = byKind[kind] || []).push({ name, kind, d });
    });
    // keep the 30 closest to the middle of the city in each group, then list them A to Z
    const rows = [];
    LANDMARK_GROUPS.forEach(([, kind]) => {
      (byKind[kind] || []).sort((a, b) => a.d - b.d).slice(0, 30).sort((a, b) => a.name.localeCompare(b.name))
        .forEach((r) => rows.push({ name: r.name, kind }));
    });
    if(rows.length){ try{ localStorage.setItem(key, JSON.stringify({ at: Date.now(), rows })); }catch(e){} }   // an empty answer may just be a busy server: do not keep it
    return rows;
  }

  window.SanghaMap = { landmarks, LANDMARK_GROUPS, search, places, reverse, reverseParts, partsOf, timezoneOf, zoneLabel, mount, links, validPoint };
})();
