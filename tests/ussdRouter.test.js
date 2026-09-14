const ussdRouter = require('../src/services/ussdRouter');

describe('ussdRouter', () => {
  beforeEach(() => ussdRouter.resetForTests());

  const parent = {
    sessionID: 's-parent',
    newSession: true,
    userData: '*928*122#',
    serviceCode: '*928*122#',
  };
  const wifi2 = {
    sessionID: 's-wifi-2',
    newSession: true,
    userData: '*928*122*2#',
    serviceCode: '*928*122#',
  };
  const wifi12 = {
    sessionID: 's-wifi-12',
    newSession: true,
    userData: '12',
    serviceCode: '*928*122#',
  };

  it('sends the parent code to the parent app', () => {
    expect(ussdRouter.classify(parent)).toBe('parent');
  });

  it('sends *2 and *12 to the WiFi app', () => {
    expect(ussdRouter.classify(wifi2)).toBe('wifi');
    expect(ussdRouter.classify(wifi12)).toBe('wifi');
    expect(ussdRouter.extensionFromDial(wifi2)).toBe('2');
    expect(ussdRouter.extensionFromDial(wifi12)).toBe('12');
  });

  it('keeps later keypresses on the same app', () => {
    ussdRouter.remember('s-wifi-2', 'wifi', 'wifi-target');
    expect(ussdRouter.classify({
      sessionID: 's-wifi-2',
      newSession: false,
      userData: '1',
    })).toBe('wifi');
  });

  it('forwards *2 only to the WiFi target URL', () => {
    const targets = [
      { id: 'parent', url: 'https://old-app.example/ussd-parent' },
      { id: 'wifi', url: 'http://127.0.0.1:3040/ussd' },
    ];
    const selected = ussdRouter.filterTargets(targets, 'wifi', 's-new');
    expect(selected.map((t) => t.id)).toEqual(['wifi']);
  });

  it('ignores empty parent replies when picking a live response', () => {
    const results = [
      { status: 'fulfilled', value: { success: true, body: { ignored: true, message: '', continueSession: false } } },
      { status: 'fulfilled', value: { success: true, body: { message: 'WiFi Vouchers\n1. Buy WiFi', continueSession: true } } },
    ];
    const targets = [
      { id: 'parent', url: 'https://old-app.example/x' },
      { id: 'wifi', url: 'http://127.0.0.1:3040/ussd' },
    ];
    const picked = ussdRouter.pickResponse(results, targets, 'wifi');
    expect(picked.body.message).toMatch(/Buy WiFi/);
    expect(picked.targetId).toBe('wifi');
  });
});
