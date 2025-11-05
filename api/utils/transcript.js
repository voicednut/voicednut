'use strict';

function cleanTranscript(raw = '') {
  return String(raw)
    .replace(/\n|\t/g, ' ')
    .replace(/\\([\/"])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  cleanTranscript,
};
