import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SITE_DESCRIPTION, SITE_TITLE, softwareApplicationJsonLd } from '../lib/seo.ts';

test('title and description name both pedals and stay within search-snippet lengths', () => {
  assert.ok(SITE_TITLE.length <= 60, SITE_TITLE);
  assert.match(SITE_TITLE, /Pocket Master/);
  assert.match(SITE_TITLE, /Matribox II Pro/);
  assert.ok(SITE_DESCRIPTION.length <= 160, String(SITE_DESCRIPTION.length));
  assert.match(SITE_DESCRIPTION, /Pocket Master/);
  assert.match(SITE_DESCRIPTION, /Matribox II Pro/);
});

test('JSON-LD is a free MIT SoftwareApplication', () => {
  const ld = softwareApplicationJsonLd();
  assert.equal(ld['@type'], 'SoftwareApplication');
  assert.equal(ld.offers.price, '0');
  assert.equal(ld.operatingSystem, 'Web, macOS, Windows, Linux');
  assert.equal(ld.applicationCategory, 'MultimediaApplication');
  assert.match(ld.license, /MIT/);
});
