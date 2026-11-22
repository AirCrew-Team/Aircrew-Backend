const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { tokenFromHandshake } = require('../src/adapters/inbound/websocket/handshakeToken');

describe('Token del socket', () => {
  it('usa auth.token cuando viene', () => {
    assert.equal(tokenFromHandshake({ auth: { token: 'abc' }, headers: { cookie: 'aircrew_token=xyz' } }), 'abc');
  });

  it('sin auth.token, usa la cookie aircrew_token', () => {
    assert.equal(tokenFromHandshake({ auth: {}, headers: { cookie: 'otra=1; aircrew_token=xyz; tema=oscuro' } }), 'xyz');
  });

  it('decodifica la cookie e ignora una mal codificada', () => {
    assert.equal(tokenFromHandshake({ headers: { cookie: 'aircrew_token=a%2Eb' } }), 'a.b');
    assert.equal(tokenFromHandshake({ headers: { cookie: 'aircrew_token=%E0%A4%A' } }), null);
  });

  it('sin token ni cookie devuelve null', () => {
    assert.equal(tokenFromHandshake({ auth: { token: '  ' }, headers: {} }), null);
    assert.equal(tokenFromHandshake(), null);
  });
});
