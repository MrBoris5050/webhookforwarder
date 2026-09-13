const { normalizeRequest, buildResponse } = require('../src/services/arkeselUssd');
const { isLiveEndpoint, endpointLabel } = require('../src/sources');

describe('live vs fire-and-forget sources', () => {
  it('treats Arkesel USSD as live', () => {
    expect(isLiveEndpoint('/webhook/arkesel-ussd')).toBe(true);
    expect(endpointLabel({ path: '/webhook/arkesel-ussd' })).toBe('Arkesel USSD');
  });

  it('treats ordinary webhook paths as fire-and-forget', () => {
    expect(isLiveEndpoint('/webhook')).toBe(false);
    expect(isLiveEndpoint('/webhook/jessco')).toBe(false);
  });
});

describe('normalizeRequest', () => {
  it('maps official Arkesel JSON fields', () => {
    const req = {
      body: {
        sessionID: '2005506191900168',
        userID: 'USSD_DOCUMENTATION',
        newSession: true,
        msisdn: '233271231234',
        userData: '*928*1#',
        network: 'AIRTELTIGO',
      },
    };
    expect(normalizeRequest(req)).toEqual({
      sessionID: '2005506191900168',
      userID: 'USSD_DOCUMENTATION',
      newSession: true,
      msisdn: '233271231234',
      userData: '*928*1#',
      network: 'AIRTELTIGO',
    });
  });

  it('accepts Africa\'s Talking-style aliases and query strings', () => {
    const req = {
      body: {},
      query: {
        sessionId: 'abc',
        phoneNumber: '233200000000',
        text: '1',
        type: 'initiation',
      },
    };
    expect(normalizeRequest(req)).toMatchObject({
      sessionID: 'abc',
      msisdn: '233200000000',
      userData: '1',
      newSession: true,
    });
  });
});

describe('buildResponse', () => {
  const incoming = { sessionID: 's1', userID: 'u1', msisdn: '2332' };

  it('passes through an official Arkesel response', () => {
    expect(buildResponse(incoming, {
      sessionID: 's1',
      userID: 'u1',
      msisdn: '2332',
      message: 'Welcome',
      continueSession: true,
    })).toEqual({
      sessionID: 's1',
      userID: 'u1',
      msisdn: '2332',
      message: 'Welcome',
      continueSession: true,
    });
  });

  it('converts CON / END text menus', () => {
    expect(buildResponse(incoming, 'CON Choose an option')).toEqual({
      sessionID: 's1',
      userID: 'u1',
      msisdn: '2332',
      message: 'Choose an option',
      continueSession: true,
    });
    expect(buildResponse(incoming, 'END Goodbye')).toMatchObject({
      message: 'Goodbye',
      continueSession: false,
    });
  });

  it('returns a fallback END message when the target has no body', () => {
    expect(buildResponse(incoming, null).continueSession).toBe(false);
    expect(buildResponse(incoming, null).message).toMatch(/unavailable/i);
  });
});
