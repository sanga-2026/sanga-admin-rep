/* Tidies text people type, so listings read well: capital letters where they belong and no stray spaces.
   It never rewrites words, only fixes capitals and spacing.
     SanghaText.sentence(s)  capital at the start and after . ! ?   (cancellation policy, description)
     SanghaText.title(s)     capital first letter                    (event title, supporting-file titles)
     SanghaText.place(s)     Every Word Capitalised                  (city, state, country)
     SanghaText.item(s)      capital first letter                    (what's included, what to bring)          */
(function (g) {
  var collapse = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };
  var capFirst = function (s) { return s.replace(/^([^A-Za-z0-9]*)([a-z])/, function (m, a, b) { return a + b.toUpperCase(); }); };
  var loneI = function (s) { return s.replace(/\bi\b(?=($|[\s',.!?;:]))/g, 'I'); };

  function sentence(s) {
    var t = String(s == null ? '' : s).replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
    t = t.replace(/(^|[.!?]\s+|\n)([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
    return loneI(t);
  }
  function title(s) { return loneI(capFirst(collapse(s))); }
  function item(s) { return capFirst(collapse(s)); }
  var MINOR = { of: 1, de: 1, la: 1, del: 1, the: 1, and: 1, van: 1, von: 1, du: 1, le: 1 };
  var ACRONYMS = { usa: 'USA', uk: 'UK', uae: 'UAE', us: 'US' };
  function place(s) {
    var words = collapse(s).split(/(\s+|-)/);
    var first = true;
    return words.map(function (w) {
      if (!/[A-Za-z]/.test(w)) return w;
      var out;
      if (w === w.toUpperCase() && w.length <= 3) out = w;                    // USA, CA, UK stay as typed
      else if (!first && MINOR[w.toLowerCase()]) out = w.toLowerCase();       // "Bay of Plenty"
      else if (ACRONYMS[w.toLowerCase()]) out = ACRONYMS[w.toLowerCase()];      // usa -> USA
      else if (w.length === 2 && !MINOR[w.toLowerCase()]) out = w.toUpperCase(); // ca -> CA (state codes)
      else out = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      first = false;
      return out;
    }).join('');
  }
  // A person's name: only the first letter of each part gets a capital ("gita kumari" -> "Gita Kumari").
  // Nothing else is changed, so "McDonald" or "de Silva" stay exactly as typed.
  function name(s) {
    return collapse(s).split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  }
  g.SanghaText = { sentence: sentence, title: title, item: item, place: place, name: name };
})(window);
