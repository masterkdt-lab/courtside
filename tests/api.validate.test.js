// tests/api.validate.test.js
// lib/validate.js: every rule in plan 4.4 and 10.5–10.7 with a failing and a passing case.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest } from '../lib/validate.js';
import { privateBody, vettedBody } from './api.helpers.js';

const errorsOf = (body) => {
  const result = validateRequest(body);
  assert.equal(result.ok, false, `expected errors for ${String(JSON.stringify(body)).slice(0, 120)}`);
  return result.errors;
};
const valueOf = (body) => {
  const result = validateRequest(body);
  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result.errors)}`);
  return result.value;
};

describe('shape and common fields', () => {
  test('non-object bodies fail with a body error', () => {
    for (const bad of [null, undefined, 'x', 5, [], true]) assert.ok(errorsOf(bad).body, String(bad));
  });

  test('requestType must be private or vetted', () => {
    assert.equal(errorsOf({ ...privateBody(), requestType: 'group' }).requestType, 'Choose a private group or a vetted group request.');
    assert.ok(errorsOf({ ...privateBody(), requestType: undefined }).requestType);
    assert.ok(errorsOf({ ...privateBody(), requestType: { x: 1 } }).requestType);
    assert.equal(valueOf(privateBody()).requestType, 'private');
    assert.equal(valueOf(vettedBody()).requestType, 'vetted');
  });

  test('consent must be boolean true', () => {
    for (const consent of [false, 'true', 1, undefined, null, 'yes']) {
      assert.equal(errorsOf(privateBody({ consent })).consent, 'Please agree to the privacy notice to send your request.');
    }
    assert.equal(valueOf(privateBody({ consent: true })).consent, true);
  });

  test('note is optional, trimmed and at most 2000 characters', () => {
    assert.equal(valueOf(privateBody({ note: '  hi  ' })).note, 'hi');
    assert.equal(valueOf(privateBody({ note: undefined })).note, '');
    assert.equal(valueOf(privateBody({ note: 'x'.repeat(2000) })).note.length, 2000);
    assert.equal(errorsOf(privateBody({ note: 'x'.repeat(2001) })).note, 'Keep notes under 2,000 characters.');
    assert.ok(errorsOf(privateBody({ note: ['a'] })).note);
  });

  test('brief is required and at most 5000 characters', () => {
    assert.equal(errorsOf(privateBody({ brief: '' })).brief, 'The trip brief is missing.');
    assert.equal(errorsOf(privateBody({ brief: '   ' })).brief, 'The trip brief is missing.');
    assert.equal(errorsOf(privateBody({ brief: undefined })).brief, 'The trip brief is missing.');
    assert.equal(errorsOf(privateBody({ brief: 'x'.repeat(5001) })).brief, 'The trip brief is too long.');
    assert.equal(valueOf(privateBody({ brief: 'x'.repeat(5000) })).brief.length, 5000);
  });

  test('unknown fields and identity fields are ignored; the honeypot passes through', () => {
    const value = valueOf(privateBody({ foo: 'bar', guestName: 'Mallory', guestEmail: 'm@example.com', inviteCode: 'ADMIN', website: ' spam ' }));
    assert.equal('foo' in value, false);
    assert.equal('guestName' in value, false);
    assert.equal('guestEmail' in value, false);
    assert.equal('inviteCode' in value, false);
    assert.equal(value.website, 'spam');
    assert.equal(valueOf(privateBody({ website: undefined })).website, '');
    assert.equal(valueOf(privateBody({ website: { x: 1 } })).website, 'filled');
  });

  test('a vetted value carries no private fields and vice versa', () => {
    const vetted = valueOf({ ...vettedBody(), players: 6, room: 'club' });
    assert.equal('players' in vetted, false);
    assert.equal('room' in vetted, false);
    const priv = valueOf({ ...privateBody(), partyType: 'Solo', priorities: ['Golf'] });
    assert.equal('partyType' in priv, false);
    assert.equal('priorities' in priv, false);
  });
});

describe('weeks', () => {
  test('private needs exactly one known week', () => {
    assert.equal(errorsOf(privateBody({ weeks: [] })).weeks, 'Choose one week.');
    assert.equal(errorsOf(privateBody({ weeks: ['w1', 'w2'] })).weeks, 'Choose one week.');
    assert.equal(errorsOf(privateBody({ weeks: 'w1' })).weeks, 'Choose one week.');
    assert.equal(errorsOf(privateBody({ weeks: undefined })).weeks, 'Choose one week.');
    assert.equal(errorsOf(privateBody({ weeks: ['w9'] })).weeks, 'Choose a week from the list.');
    assert.equal(errorsOf(privateBody({ weeks: ['Feb 7–13'] })).weeks, 'Choose a week from the list.');
    assert.equal(errorsOf(privateBody({ weeks: [{ id: 'w1' }] })).weeks, 'Choose a week from the list.');
    assert.deepEqual(valueOf(privateBody({ weeks: [' w5 '] })).weeks, ['w5']);
  });

  test('vetted needs one or more known weeks without duplicates', () => {
    assert.equal(errorsOf(vettedBody({ weeks: [] })).weeks, 'Choose at least one week.');
    assert.equal(errorsOf(vettedBody({ weeks: undefined })).weeks, 'Choose at least one week.');
    assert.equal(errorsOf(vettedBody({ weeks: ['w1', 'w1'] })).weeks, 'Each week can be chosen once.');
    assert.equal(errorsOf(vettedBody({ weeks: ['w1', 'nope'] })).weeks, 'Choose a week from the list.');
    assert.deepEqual(valueOf(vettedBody({ weeks: ['w1'] })).weeks, ['w1']);
    assert.deepEqual(valueOf(vettedBody({ weeks: ['w7', 'w1', 'w4'] })).weeks, ['w7', 'w1', 'w4']);
  });
});

describe('private', () => {
  test('players is an integer 4–12 (numeric strings accepted)', () => {
    for (const players of [3, 13, 0, -4, 6.5, 'six', '', null, undefined, '6.0']) {
      assert.equal(errorsOf(privateBody({ players })).players, 'Players must be between 4 and 12.', String(players));
    }
    assert.equal(valueOf(privateBody({ players: '6' })).players, 6);
    assert.equal(valueOf(privateBody({ players: 4 })).players, 4);
    assert.equal(valueOf(privateBody({ players: 12, singleRooms: 0 })).players, 12);
  });

  test('partners is an integer 0–12', () => {
    assert.equal(errorsOf(privateBody({ partners: -1 })).partners, 'Partners must be between 0 and 12.');
    assert.equal(errorsOf(privateBody({ partners: 13 })).partners, 'Partners must be between 0 and 12.');
    assert.equal(errorsOf(privateBody({ partners: 'two' })).partners, 'Partners must be between 0 and 12.');
    assert.equal(valueOf(privateBody({ partners: '0' })).partners, 0);
    assert.equal(valueOf(privateBody({ partners: 12 })).partners, 12);
  });

  test('singleRooms is an integer from 0 to players + partners', () => {
    assert.equal(errorsOf(privateBody({ players: 6, partners: 2, singleRooms: 9 })).singleRooms, 'Single rooms must be between 0 and 8.');
    assert.equal(errorsOf(privateBody({ singleRooms: -1 })).singleRooms, 'Single rooms must be between 0 and 8.');
    assert.equal(errorsOf(privateBody({ singleRooms: 1.5 })).singleRooms, 'Single rooms must be between 0 and 8.');
    assert.equal(errorsOf(privateBody({ players: 'x', singleRooms: -1 })).singleRooms, 'Single rooms must be 0 or more.');
    assert.equal(valueOf(privateBody({ players: 6, partners: 2, singleRooms: 8 })).singleRooms, 8);
    assert.equal(valueOf(privateBody({ singleRooms: '2' })).singleRooms, 2);
    assert.equal(valueOf(privateBody({ singleRooms: 0 })).singleRooms, 0);
  });

  test('room and tennis must be catalog ids (trimmed)', () => {
    assert.equal(errorsOf(privateBody({ room: 'penthouse' })).room, 'Choose a room.');
    assert.equal(errorsOf(privateBody({ room: 'Club View' })).room, 'Choose a room.');
    assert.equal(errorsOf(privateBody({ room: undefined })).room, 'Choose a room.');
    assert.equal(errorsOf(privateBody({ tennis: 'none' })).tennis, 'Choose a tennis option.');
    assert.equal(errorsOf(privateBody({ tennis: undefined })).tennis, 'Choose a tennis option.');
    const value = valueOf(privateBody({ room: ' royal ', tennis: 'custom' }));
    assert.equal(value.room, 'royal');
    assert.equal(value.tennis, 'custom');
  });

  test('add-ons: known ids, no duplicates, qty for player/guest only', () => {
    assert.equal(errorsOf(privateBody({ addons: [{ id: 'helicopter', qty: 1 }] })).addons, 'Choose add-ons from the list.');
    assert.equal(errorsOf(privateBody({ addons: ['eva'] })).addons, 'Choose add-ons from the list.');
    assert.equal(errorsOf(privateBody({ addons: [{ qty: 2 }] })).addons, 'Choose add-ons from the list.');
    assert.equal(errorsOf(privateBody({ addons: [{ id: 'golf', qty: 2 }, { id: 'golf', qty: 3 }] })).addons, 'Each add-on can be chosen once.');
    assert.equal(errorsOf(privateBody({ addons: [{ id: 'eva' }] })).addons, 'Enter how many for Extra session with Eva.');
    assert.equal(errorsOf(privateBody({ addons: [{ id: 'padel', qty: 0 }] })).addons, 'Enter how many for Padel.');
    assert.equal(errorsOf(privateBody({ addons: [{ id: 'massage', qty: 'two' }] })).addons, 'Enter how many for Massage.');
    assert.equal(errorsOf(privateBody({ addons: [{ id: 'dinner', qty: 1.5 }] })).addons, 'Enter how many for Extra curated dinner.');
    assert.equal(errorsOf(privateBody({ addons: 'eva' })).addons, 'Add-ons must be a list.');

    assert.deepEqual(valueOf(privateBody({ addons: undefined })).addons, []);
    assert.deepEqual(valueOf(privateBody({ addons: [] })).addons, []);
    assert.deepEqual(
      valueOf(privateBody({ addons: [{ id: 'eva', qty: '6' }, { id: 'golf', qty: 4 }, { id: 'driver', qty: 99 }, { id: 'free' }] })).addons,
      [{ id: 'eva', qty: 6 }, { id: 'golf', qty: 4 }, { id: 'driver' }, { id: 'free' }],
    );
    const every = ['eva', 'padel', 'massage', 'golf', 'alicante', 'cartagena', 'food', 'dinner'].map((id) => ({ id, qty: 1 }));
    assert.equal(valueOf(privateBody({ addons: [...every, { id: 'driver' }, { id: 'free' }] })).addons.length, 10);
  });

  test('estimates: player and group required, partner may be blank, all at most 60 characters', () => {
    assert.equal(errorsOf(privateBody({ playerEstimate: '' })).playerEstimate, 'The player estimate is missing.');
    assert.equal(errorsOf(privateBody({ playerEstimate: undefined })).playerEstimate, 'The player estimate is missing.');
    assert.equal(errorsOf(privateBody({ groupEstimate: '' })).groupEstimate, 'The group estimate is missing.');
    assert.equal(errorsOf(privateBody({ playerEstimate: 'x'.repeat(61) })).playerEstimate, 'The player estimate is too long.');
    assert.equal(errorsOf(privateBody({ partnerEstimate: 'x'.repeat(61) })).partnerEstimate, 'The partner estimate is too long.');
    assert.equal(errorsOf(privateBody({ groupEstimate: 'x'.repeat(61) })).groupEstimate, 'The group estimate is too long.');
    assert.equal(errorsOf(privateBody({ partnerEstimate: { x: 1 } })).partnerEstimate, 'The partner estimate is missing.');
    const value = valueOf(privateBody({ partnerEstimate: '', playerEstimate: ' $3,400–$3,700 ', groupEstimate: 'x'.repeat(60) }));
    assert.equal(value.partnerEstimate, '');
    assert.equal(value.playerEstimate, '$3,400–$3,700');
    assert.equal(value.groupEstimate.length, 60);
    assert.equal(valueOf(privateBody({ partnerEstimate: undefined })).partnerEstimate, '');
  });

  test('a fully valid private body yields the coerced value', () => {
    assert.deepEqual(valueOf(privateBody({ players: '6', partners: '2', singleRooms: '1' })), {
      requestType: 'private',
      weeks: ['w5'],
      consent: true,
      website: '',
      note: 'Celebrating a birthday that week.',
      brief: privateBody().brief,
      players: 6,
      partners: 2,
      singleRooms: 1,
      room: 'club',
      tennis: 'daily',
      addons: [{ id: 'eva', qty: 6 }, { id: 'massage', qty: 8 }, { id: 'driver' }, { id: 'free' }],
      playerEstimate: '$3,400–$3,700',
      partnerEstimate: '$2,200–$2,400',
      groupEstimate: '$30,000–$32,000',
    });
  });

  test('reports every failing field at once', () => {
    const errors = errorsOf(privateBody({ players: 2, room: 'x', consent: false, brief: '', weeks: [] }));
    assert.deepEqual(Object.keys(errors).sort(), ['brief', 'consent', 'players', 'room', 'weeks']);
  });
});

describe('vetted', () => {
  test('partyType, level, tennisStyle and travelStyle must be in their sets', () => {
    assert.equal(errorsOf(vettedBody({ partyType: 'Family' })).partyType, 'Choose who you are coming as.');
    assert.equal(errorsOf(vettedBody({ partyType: undefined })).partyType, 'Choose who you are coming as.');
    assert.equal(errorsOf(vettedBody({ level: '6.0' })).level, 'Choose a tennis level.');
    assert.equal(errorsOf(vettedBody({ tennisStyle: 'Casual' })).tennisStyle, 'Choose your ideal tennis.');
    assert.equal(errorsOf(vettedBody({ travelStyle: 'Solo' })).travelStyle, 'Choose a travel style.');
    const value = valueOf(vettedBody({ partyType: '2–3 friends', level: 'Mixed / not sure', tennisStyle: 'Mostly here for the trip', travelStyle: 'Very social' }));
    assert.equal(value.partyType, '2–3 friends');
    assert.equal(value.level, 'Mixed / not sure');
    assert.equal(value.tennisStyle, 'Mostly here for the trip');
    assert.equal(value.travelStyle, 'Very social');
    assert.equal(valueOf(vettedBody({ level: 3.5 })).level, '3.5');
  });

  test('priorities are optional, from the set, without duplicates', () => {
    assert.equal(errorsOf(vettedBody({ priorities: ['Nightlife'] })).priorities, 'Choose priorities from the list.');
    assert.equal(errorsOf(vettedBody({ priorities: ['Golf', 'Golf'] })).priorities, 'Each priority can be chosen once.');
    assert.equal(errorsOf(vettedBody({ priorities: 'Golf' })).priorities, 'Priorities must be a list.');
    assert.deepEqual(valueOf(vettedBody({ priorities: [] })).priorities, []);
    assert.deepEqual(valueOf(vettedBody({ priorities: undefined })).priorities, []);
    const every = ['Great tennis', 'Food + long lunches', 'Wellness + spa', 'Golf', 'Exploring', 'Downtime'];
    assert.deepEqual(valueOf(vettedBody({ priorities: every })).priorities, every);
  });

  test('a fully valid vetted body yields the coerced value', () => {
    assert.deepEqual(valueOf(vettedBody()), {
      requestType: 'vetted',
      weeks: ['w2', 'w3'],
      consent: true,
      website: '',
      note: 'We play most weekends.',
      brief: vettedBody().brief,
      partyType: 'Couple',
      level: '4.0',
      tennisStyle: 'Competitive / serious',
      travelStyle: 'Independent',
      priorities: ['Great tennis', 'Golf'],
    });
  });
});
