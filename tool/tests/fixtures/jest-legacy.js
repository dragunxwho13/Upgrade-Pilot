// fixture: jest-legacy.js
// Fake test file using Jest 27 patterns that break in Jest 29.
// Used as a test fixture only — never executed by Jest.
'use strict';

// Rule: jest/set-timeout  (line 8)
jest.setTimeout(10000);

// Rule: jest/jasmine-globals  (line 11 and 14)
const spy = jasmine.createSpy('myFn');
describe('example', () => {
  it('uses jasmine spy', () => {
    jasmine.clock().install();
    expect(spy).toBeDefined();
  });
});
